const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { renderPdf } = require('./pdfRenderer');
const { buildPageHtml } = require('./reportCardHtmlBuilder');
const { uploadPdf, isConfigured } = require('./supabaseStorageService');
const fs = require('fs');
const path = require('path');

const DEFAULT_BLOCKS = [
  { id: 'blk_header', type: 'header', label: 'School Header & Crest', enabled: true },
  { id: 'blk_student', type: 'student-info', label: 'Student Information', enabled: true },
  { id: 'blk_results', type: 'results-table', label: 'Results Table', enabled: true },
  { id: 'blk_attendance', type: 'attendance', label: 'Attendance Summary', enabled: false },
  { id: 'blk_traits', type: 'traits', label: 'Affective Traits', enabled: false },
  { id: 'blk_comments', type: 'comments', label: 'Class Teacher\'s Comments', enabled: true },
  { id: 'blk_signatures', type: 'signatures', label: 'Signatures', enabled: true }
];

const DEFAULT_TRAITS = ['Punctuality', 'Conduct', 'Neatness', 'Participation', 'Leadership'];

// ===== RESULT PUBLISHING =====

const getPublishStatus = async (schoolId, termId, classId) => {
  const [sheets, school, term, classRecord] = await Promise.all([
    prisma.scoreSheet.findMany({
      where: { schoolId, termId, classId },
      select: { status: true }
    }),
    prisma.school.findUnique({
      where: { id: schoolId },
      select: { defaultGradingScaleId: true }
    }),
    prisma.academicTerm.findUnique({
      where: { id: termId },
      select: { startDate: true, endDate: true }
    }),
    prisma.class.findUnique({
      where: { id: classId },
      select: { name: true }
    })
  ]);

  const className = classRecord?.name;
  const subjects = await prisma.armSubject.findMany({
    where: { arm: { schoolId, classId, isActive: true } },
    include: { subject: { select: { name: true } } }
  });
  const subjectNames = [...new Set(subjects.map(s => s.subject.name))];

  const entries = await prisma.assessmentEntry.findMany({
    where: { schoolId, termId, className },
    select: { id: true, subjectName: true }
  });

  const completedBySubject = {};
  for (const entry of entries) {
    const count = await prisma.assessmentScore.count({ where: { entryId: entry.id } });
    if (!completedBySubject[entry.subjectName]) completedBySubject[entry.subjectName] = { total: 0, scored: 0 };
    completedBySubject[entry.subjectName].total++;
    if (count > 0) completedBySubject[entry.subjectName].scored++;
  }

  const newModelComplete = subjectNames.every(sn =>
    completedBySubject[sn] && completedBySubject[sn].total > 0 &&
    completedBySubject[sn].scored === completedBySubject[sn].total
  );

  const totalSubjects = subjectNames.length;
  const newModelCompletedCount = newModelComplete ? totalSubjects : Object.values(completedBySubject).filter(v => v.scored === v.total).length;

  const legacyCompleted = sheets.filter(s => s.status === 'approved').length;
  const totalLegacy = sheets.length;
  const allLegacyComplete = totalLegacy > 0 && legacyCompleted === totalLegacy;

  const allComplete = newModelComplete || allLegacyComplete;

  const schemesAssigned = !!school?.defaultGradingScaleId;
  const termDatesSet = !!(term?.startDate && term?.endDate);

  const publication = await prisma.resultPublication.findUnique({
    where: {
      schoolId_termId_classId: { schoolId, termId, classId }
    }
  });

  const published = publication?.published || false;

  return {
    published,
    publishedAt: publication?.publishedAt || null,
    checklist: {
      allComplete: {
        passed: allComplete,
        label: 'All subjects completed',
        detail: allComplete
          ? `All subjects completed`
          : `${newModelCompletedCount} of ${totalSubjects} subjects completed`
      },
      schemesAssigned: {
        passed: schemesAssigned,
        label: 'Grading scheme assigned to every subject',
        detail: schemesAssigned
          ? 'Default grading scale is configured'
          : 'No default grading scale has been set'
      },
      termDatesSet: {
        passed: termDatesSet,
        label: 'Academic term dates are set',
        detail: termDatesSet
          ? 'Term start and end dates are configured'
          : 'Term dates have not been set'
      }
    }
  };
};

const publishResults = async (schoolId, termId, classId, userId) => {
  const publication = await prisma.resultPublication.upsert({
    where: {
      schoolId_termId_classId: { schoolId, termId, classId }
    },
    update: {
      published: true,
      publishedAt: new Date(),
      publishedBy: userId
    },
    create: {
      schoolId,
      termId,
      classId,
      published: true,
      publishedAt: new Date(),
      publishedBy: userId
    }
  });

  logger.info(`Results published for term ${termId}, class ${classId} by user ${userId}`);
  return {
    published: publication.published,
    publishedAt: publication.publishedAt
  };
};

// ===== PDF JOBS =====

const createPdfJob = async (schoolId, type, metadata) => {
  const job = await prisma.pdfJob.create({
    data: {
      schoolId,
      type,
      status: 'processing',
      progress: 0,
      metadata: metadata || {}
    }
  });

  logger.info(`PDF job ${job.id} created for ${type}`);

  process.nextTick(async () => {
    try {
      await processPdfJob(job.id, schoolId, type, metadata);
    } catch (err) {
      logger.error(`PDF job ${job.id} failed:`, err);
      await prisma.pdfJob.update({
        where: { id: job.id },
        data: { status: 'failed', progress: 0 }
      }).catch(() => {});
    }
  });

  return { jobId: job.id };
};

const getPdfJob = async (schoolId, jobId) => {
  const job = await prisma.pdfJob.findFirst({
    where: { id: jobId, schoolId }
  });

  if (!job) return null;

  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    downloadUrl: job.downloadUrl
  };
};

const processPdfJob = async (jobId, schoolId, type, metadata) => {
  const { termId, classId, armId } = metadata || {};

  const [school, term, template] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId } }),
    prisma.academicTerm.findUnique({ where: { id: termId } }),
    prisma.reportCardTemplate.findUnique({ where: { schoolId } })
  ]);

  const termName = term?.name || 'Unknown Term';

  const defaultTemplate = {
    orientation: 'portrait',
    accent: 'blue',
    blocks: DEFAULT_BLOCKS
  };
  const activeTemplate = template || defaultTemplate;

  const arms = armId
    ? await prisma.arm.findMany({
        where: { id: armId, schoolId, isActive: true },
        include: { class: { select: { name: true } } }
      })
    : await prisma.arm.findMany({
        where: { schoolId, classId, isActive: true },
        include: { class: { select: { name: true } } }
      });

  const students = await prisma.student.findMany({
    where: { schoolId, armId: { in: arms.map(a => a.id) }, isActive: true, isEnrolled: true },
    select: { id: true, firstName: true, lastName: true, studentId: true, armId: true }
  });

  const total = students.length;
  let completed = 0;

  const pdfBuffers = [];

  for (const student of students) {
    const arm = arms.find(a => a.id === student.armId);
    const className = arm?.class?.name || '';

    const scores = await compileStudentScores(schoolId, termId, student.id, student.armId);

    const html = buildPageHtml(
      {
        name: `${student.firstName} ${student.lastName}`,
        admissionNo: student.studentId,
        subjects: scores.subjects,
        totalScore: scores.totalScore,
        average: scores.average,
        gradePointAverage: scores.gradePointAverage,
        position: scores.position,
        comment: scores.comment,
        traits: scores.traits,
        attendance: scores.attendance
      },
      school || {},
      activeTemplate,
      termName,
      className
    );

    const pdfBuffer = await renderPdf(html, {
      landscape: activeTemplate.orientation === 'landscape'
    });

    pdfBuffers.push({ studentId: student.id, buffer: pdfBuffer });

    completed++;
    if (completed % 5 === 0 || completed === total) {
      const pct = Math.round((completed / total) * 100);
      await prisma.pdfJob.update({
        where: { id: jobId },
        data: { progress: pct }
      }).catch(() => {});
    }
  }

  // Combine all individual PDFs into one batch, or upload individually
  // For now, upload as a single combined PDF
  const combinedBuffer = Buffer.concat(pdfBuffers.map(p => p.buffer));

  let downloadUrl = null;
  if (isConfigured()) {
    downloadUrl = await uploadPdf(combinedBuffer, { schoolId, termId, armId, studentId: 'batch' });
  }

  if (!downloadUrl) {
    const dir = path.join(__dirname, '../../uploads/pdfs');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${jobId}.pdf`);
    fs.writeFileSync(filePath, combinedBuffer);
    downloadUrl = `/uploads/pdfs/${jobId}.pdf`;
  }

  await prisma.pdfJob.update({
    where: { id: jobId },
    data: {
      status: 'completed',
      progress: 100,
      downloadUrl
    }
  });

  logger.info(`PDF job ${jobId} completed: ${total} report cards generated`);
};

const downloadPdf = async (schoolId, jobId) => {
  const job = await prisma.pdfJob.findFirst({
    where: { id: jobId, schoolId }
  });
  if (!job) return { notFound: true };
  if (!job.downloadUrl) return { notFound: false, downloadUrl: null };

  // Local file saved during generation (new behavior)
  if (job.downloadUrl.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '../..', job.downloadUrl);
    if (fs.existsSync(filePath)) {
      return { downloadUrl: job.downloadUrl, isLocal: true, filePath };
    }
    return { notFound: false, downloadUrl: null, message: 'PDF file not found on server' };
  }

  // Old fallback URL that points to itself — resolve to local file
  if (job.downloadUrl.startsWith('/api/admin/results/pdf-jobs/')) {
    const filePath = path.join(__dirname, '../../uploads/pdfs', `${jobId}.pdf`);
    if (fs.existsSync(filePath)) {
      return { downloadUrl: job.downloadUrl, isLocal: true, filePath };
    }
    return { notFound: false, downloadUrl: null, message: 'PDF file not found on server' };
  }

  return { downloadUrl: job.downloadUrl };
};

const compileStudentScores = async (schoolId, termId, studentId, armId) => {
  const GradingScaleService = require('./gradingScaleService');

  const arm = await prisma.arm.findFirst({
    where: { id: armId, schoolId, isActive: true },
    include: {
      class: { select: { name: true } },
      armSubjects: { include: { subject: { select: { id: true, name: true } } } }
    }
  });

  if (!arm) return { subjects: [], totalScore: 0, average: 0, gradePointAverage: 0, position: 0 };

  const className = arm.class.name;
  const subjectList = arm.armSubjects.map(as => ({ id: as.subject.id, name: as.subject.name }));

  const entries = await prisma.assessmentEntry.findMany({
    where: { schoolId, termId, className, subjectName: { in: subjectList.map(s => s.name) } },
    include: { scores: { where: { studentId } } }
  });

  const scoresBySubject = {};
  for (const entry of entries) {
    const score = entry.scores[0];
    if (!scoresBySubject[entry.subjectName]) scoresBySubject[entry.subjectName] = 0;
    scoresBySubject[entry.subjectName] += score ? score.score : 0;
  }

  // Fallback to legacy sheets
  const sheets = await prisma.scoreSheet.findMany({
    where: { schoolId, termId, classId: arm.classId, subjectId: { in: subjectList.map(s => s.id) } },
    include: { entries: { where: { studentId } } }
  });

  const subjects = subjectList.map(subject => {
    const newScore = scoresBySubject[subject.name];
    if (newScore != null) {
      const gradeResult = GradingScaleService.resolveGrade(schoolId, newScore);
      return { name: subject.name, ca: newScore, exam: 0, total: newScore, grade: gradeResult?.label || null };
    }

    const sheet = sheets.find(s => s.subjectId === subject.id);
    if (sheet) {
      const entry = sheet.entries[0];
      if (entry) {
        const ca = entry.caScores
          ? Object.values(entry.caScores).reduce((sum, v) => sum + (Number(v) || 0), 0)
          : 0;
        const exam = entry.examScore || 0;
        const total = ca + exam;
        const gradeResult = GradingScaleService.resolveGrade(schoolId, total);
        return { name: subject.name, ca, exam, total, grade: gradeResult?.label || null };
      }
    }

    return { name: subject.name, ca: null, exam: null, total: null, grade: null };
  });

  const scoredSubjects = subjects.filter(s => s.total != null);
  const totalScore = scoredSubjects.reduce((sum, s) => sum + s.total, 0);
  const subjectsWithScores = scoredSubjects.length;
  const average = subjectsWithScores > 0 ? Math.round((totalScore / subjectsWithScores) * 10) / 10 : 0;

  let totalGradePoints = 0;
  for (const s of scoredSubjects) {
    const gradeResult = GradingScaleService.resolveGrade(schoolId, s.total);
    if (gradeResult && gradeResult.gradePoints != null) {
      totalGradePoints += gradeResult.gradePoints;
    }
  }
  const gradePointAverage = subjectsWithScores > 0
    ? Math.round((totalGradePoints / subjectsWithScores) * 100) / 100
    : 0;

  const comments = await prisma.reportCardComment.findFirst({
    where: { studentId, armId, termId }
  });

  return {
    subjects,
    totalScore,
    average,
    gradePointAverage,
    position: 0,
    comment: comments?.comment || null,
    traits: comments?.traits || null,
    attendance: null
  };
};

// ===== REPORT CARD TEMPLATE =====

const getTemplate = async (schoolId) => {
  let template = await prisma.reportCardTemplate.findUnique({
    where: { schoolId }
  });

  if (!template) {
    template = await prisma.reportCardTemplate.create({
      data: {
        schoolId,
        orientation: 'portrait',
        accent: 'blue',
        blocks: DEFAULT_BLOCKS
      }
    });
  }

  return {
    orientation: template.orientation,
    accent: template.accent,
    blocks: template.blocks
  };
};

const saveTemplate = async (schoolId, data) => {
  const template = await prisma.reportCardTemplate.upsert({
    where: { schoolId },
    update: {
      orientation: data.orientation || undefined,
      accent: data.accent || undefined,
      blocks: data.blocks || undefined
    },
    create: {
      schoolId,
      orientation: data.orientation || 'portrait',
      accent: data.accent || 'blue',
      blocks: data.blocks || DEFAULT_BLOCKS
    }
  });

  logger.info(`Report card template saved for school ${schoolId}`);
  return {
    orientation: template.orientation,
    accent: template.accent,
    blocks: template.blocks
  };
};

// ===== REPORT CARD COMMENTS =====

const getCommentsWorklist = async (schoolId, armId, termId) => {
  const arm = await prisma.arm.findFirst({
    where: { id: armId, schoolId, isActive: true },
    include: {
      students: {
        where: { isActive: true, isEnrolled: true },
        select: { id: true, firstName: true, lastName: true, studentId: true }
      }
    }
  });

  if (!arm) return null;

  const existingComments = await prisma.reportCardComment.findMany({
    where: { schoolId, armId, termId }
  });

  const commentMap = {};
  for (const c of existingComments) {
    commentMap[c.studentId] = c;
  }

  const students = arm.students.map(student => {
    const existing = commentMap[student.id];
    return {
      id: student.id,
      name: `${student.firstName} ${student.lastName}`,
      admissionNo: student.studentId || null,
      comment: existing?.comment || null,
      traits: existing?.traits || null,
      status: existing?.status || 'pending'
    };
  });

  return {
    traits: DEFAULT_TRAITS,
    students
  };
};

const saveComment = async (schoolId, studentId, data) => {
  const { armId, termId, comment, traits } = data;

  const status = comment ? 'completed' : 'pending';

  const saved = await prisma.reportCardComment.upsert({
    where: {
      studentId_armId_termId: { studentId, armId, termId }
    },
    update: {
      comment: comment || null,
      traits: traits || undefined,
      status
    },
    create: {
      schoolId,
      studentId,
      armId,
      termId,
      comment: comment || null,
      traits: traits || {},
      status
    }
  });

  logger.info(`Comment saved for student ${studentId} in arm ${armId}, term ${termId}`);
  return {
    studentId: saved.studentId,
    status: saved.status
  };
};

// ===== REPORT CARD GENERATE =====

const generateReportCards = async (schoolId, armId, termId) => {
  const job = await createPdfJob(schoolId, 'report_card', { armId, termId });
  logger.info(`Report card generation started for arm ${armId}, term ${termId}`);
  return job;
};

// ===== REPORT CARD SIGN-OFF =====

const signOff = async (schoolId, armId, termId, userId) => {
  const publication = await prisma.reportCardPublication.upsert({
    where: {
      schoolId_armId_termId: { schoolId, armId, termId }
    },
    update: {
      signedOff: true,
      signedAt: new Date(),
      signedBy: userId
    },
    create: {
      schoolId,
      armId,
      termId,
      signedOff: true,
      signedAt: new Date(),
      signedBy: userId
    }
  });

  logger.info(`Report cards signed off for arm ${armId}, term ${termId} by user ${userId}`);
  return {
    signedOff: publication.signedOff,
    signedAt: publication.signedAt
  };
};

// ===== REPORT CARD PUBLISH TO PARENTS =====

const publishToParents = async (schoolId, armId, termId, userId, studentIds) => {
  const studentCount = studentIds && studentIds.length > 0
    ? studentIds.length
    : await prisma.student.count({
        where: { schoolId, armId, isActive: true, isEnrolled: true }
      });

  const publication = await prisma.reportCardPublication.upsert({
    where: {
      schoolId_armId_termId: { schoolId, armId, termId }
    },
    update: {
      released: true,
      releasedAt: new Date(),
      releasedBy: userId,
      publishedCount: studentCount
    },
    create: {
      schoolId,
      armId,
      termId,
      released: true,
      releasedAt: new Date(),
      releasedBy: userId,
      publishedCount: studentCount
    }
  });

  logger.info(`Report cards published for arm ${armId}, term ${termId} to ${studentCount} students`);
  return {
    publishedCount: publication.publishedCount,
    publishedAt: publication.releasedAt
  };
};

module.exports = {
  getPublishStatus,
  publishResults,
  createPdfJob,
  getPdfJob,
  downloadPdf,
  getTemplate,
  saveTemplate,
  getCommentsWorklist,
  saveComment,
  generateReportCards,
  signOff,
  publishToParents,
  processPdfJob,
  compileStudentScores
};
