const { prisma } = require('../config/database');
const logger = require('../utils/logger');

const formatEntry = (entry) => ({
  id: entry.id,
  policyComponentId: entry.policyComponentId,
  policyComponentName: entry.componentType === 'exam' ? 'Exam' : null,
  componentType: entry.componentType,
  title: entry.title,
  assessmentType: entry.assessmentType,
  className: entry.className,
  subjectName: entry.subjectName,
  termId: entry.termId,
  maxObtainableScore: entry.maxObtainableScore,
  contributionPoints: entry.contributionPoints,
  createdBy: entry.createdBy,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
  scores: (entry.scores || []).map(s => ({
    studentId: s.studentId,
    studentName: s.student ? `${s.student.firstName} ${s.student.lastName}` : null,
    scoreObtained: s.scoreObtained,
    calculatedContribution: s.maxObtainable
      ? parseFloat(((s.scoreObtained / s.maxObtainable) * entry.contributionPoints).toFixed(2))
      : null
  }))
});

const validateTeacherAssignment = async (teacherId, schoolId, className, subjectName) => {
  const teacher = await prisma.user.findUnique({
    where: { id: teacherId },
    select: { classes: true, subjects: true, schoolId: true }
  });
  if (!teacher || teacher.schoolId !== schoolId) {
    throw new Error('Teacher not found');
  }
  if (!teacher.classes.includes(className)) {
    throw new Error('Teacher is not assigned to this class');
  }
  if (!teacher.subjects.includes(subjectName)) {
    throw new Error('Teacher is not assigned to this subject');
  }
  return teacher;
};

const getEffectivePolicyForEntry = async (schoolId, className, subjectName) => {
  const classRecord = await prisma.class.findFirst({
    where: { schoolId, name: className, isActive: true }
  });
  if (!classRecord) throw new Error('Class not found');

  const subjectRecord = await prisma.subject.findFirst({
    where: { schoolId, name: subjectName, isActive: true }
  });
  if (!subjectRecord) throw new Error('Subject not found');

  const policy = await prisma.assessmentPolicy.findFirst({
    where: {
      schoolId,
      assignments: {
        some: {
          scope: 'subject_class',
          scopeId: subjectRecord.id,
          secondaryScopeId: classRecord.id
        }
      }
    },
    include: { components: { orderBy: { sortOrder: 'asc' } } }
  });
  if (!policy) throw new Error('No assessment policy assigned for this class and subject');
  return policy;
};

const getUsedContributionPoints = async (policyComponentId, entryIdToExclude) => {
  const where = { policyComponentId };
  if (entryIdToExclude) {
    where.id = { not: entryIdToExclude };
  }
  const entries = await prisma.assessmentEntry.findMany({
    where,
    select: { contributionPoints: true }
  });
  return entries.reduce((sum, e) => sum + e.contributionPoints, 0);
};

const listEntries = async (teacherId, schoolId, className, subjectName, termId) => {
  const entries = await prisma.assessmentEntry.findMany({
    where: { schoolId, className, subjectName, termId, createdBy: teacherId },
    include: {
      scores: {
        include: {
          student: { select: { id: true, firstName: true, lastName: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  return entries.map(formatEntry);
};

const createEntry = async (teacherId, schoolId, data) => {
  const { policyComponentId, componentType, title, assessmentType, className, subjectName, termId, maxObtainableScore, contributionPoints } = data;

  await validateTeacherAssignment(teacherId, schoolId, className, subjectName);

  const policy = await getEffectivePolicyForEntry(schoolId, className, subjectName);

  let componentMax = 0;
  if (componentType === 'ca') {
    const comp = policy.components.find(c => c.id === policyComponentId);
    if (!comp) throw new Error('CA component not found in the assigned policy');
    componentMax = comp.maxScore;
  } else if (componentType === 'exam') {
    componentMax = policy.examMax;
  } else {
    throw new Error('componentType must be ca or exam');
  }

  const used = await getUsedContributionPoints(policyComponentId);
  if (used + contributionPoints > componentMax) {
    throw new Error(
      `Contribution points exceed component max of ${componentMax}: already used ${used}, trying to add ${contributionPoints}`
    );
  }

  const entry = await prisma.assessmentEntry.create({
    data: {
      schoolId,
      policyComponentId,
      componentType,
      title,
      assessmentType,
      className,
      subjectName,
      termId,
      maxObtainableScore,
      contributionPoints,
      createdBy: teacherId
    },
    include: { scores: { include: { student: { select: { id: true, firstName: true, lastName: true } } } } }
  });

  logger.info(`Teacher ${teacherId} created assessment entry ${entry.id}`);
  return formatEntry(entry);
};

const updateEntry = async (entryId, teacherId, schoolId, data) => {
  const existing = await prisma.assessmentEntry.findFirst({
    where: { id: entryId, createdBy: teacherId, schoolId }
  });
  if (!existing) return { notFound: true };

  if (data.policyComponentId || data.componentType || data.className || data.subjectName || data.termId) {
    return { cannotChange: true };
  }

  const updateData = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.assessmentType !== undefined) updateData.assessmentType = data.assessmentType;
  if (data.maxObtainableScore !== undefined) updateData.maxObtainableScore = data.maxObtainableScore;

  if (data.contributionPoints !== undefined) {
    const used = await getUsedContributionPoints(existing.policyComponentId, entryId);
    const policy = await getEffectivePolicyForEntry(schoolId, existing.className, existing.subjectName);

    let componentMax = 0;
    if (existing.componentType === 'ca') {
      const comp = policy.components.find(c => c.id === existing.policyComponentId);
      if (!comp) throw new Error('CA component no longer found in assigned policy');
      componentMax = comp.maxScore;
    } else {
      componentMax = policy.examMax;
    }

    if (used + data.contributionPoints > componentMax) {
      throw new Error(
        `Contribution points exceed component max of ${componentMax}: other entries use ${used}`
      );
    }
    updateData.contributionPoints = data.contributionPoints;
  }

  const entry = await prisma.assessmentEntry.update({
    where: { id: entryId },
    data: updateData,
    include: { scores: { include: { student: { select: { id: true, firstName: true, lastName: true } } } } }
  });

  logger.info(`Teacher ${teacherId} updated assessment entry ${entryId}`);
  return formatEntry(entry);
};

const deleteEntry = async (entryId, teacherId, schoolId) => {
  const existing = await prisma.assessmentEntry.findFirst({
    where: { id: entryId, createdBy: teacherId, schoolId }
  });
  if (!existing) return { notFound: true };

  await prisma.assessmentEntry.delete({ where: { id: entryId } });
  logger.info(`Teacher ${teacherId} deleted assessment entry ${entryId}`);
  return { deleted: true };
};

const saveScores = async (entryId, teacherId, schoolId, scores) => {
  const entry = await prisma.assessmentEntry.findFirst({
    where: { id: entryId, createdBy: teacherId, schoolId }
  });
  if (!entry) return { notFound: true };

  await prisma.assessmentScore.deleteMany({ where: { entryId } });

  if (scores.length > 0) {
    for (const s of scores) {
      if (s.scoreObtained < 0 || s.scoreObtained > entry.maxObtainableScore) {
        return { validationError: `Score for student ${s.studentId} must be between 0 and ${entry.maxObtainableScore}` };
      }
    }

    await prisma.assessmentScore.createMany({
      data: scores.map(s => ({
        entryId,
        studentId: s.studentId,
        scoreObtained: s.scoreObtained
      }))
    });
  }

  const updated = await prisma.assessmentEntry.findUnique({
    where: { id: entryId },
    include: { scores: { include: { student: { select: { id: true, firstName: true, lastName: true } } } } }
  });

  return formatEntry(updated);
};

const getGradingActivity = async (schoolId, className, armName, subjectName, termId) => {
  const classRecord = await prisma.class.findFirst({
    where: { schoolId, name: className, isActive: true }
  });
  if (!classRecord) throw new Error('Class not found');

  const subjectRecord = await prisma.subject.findFirst({
    where: { schoolId, name: subjectName, isActive: true }
  });
  if (!subjectRecord) throw new Error('Subject not found');

  const arm = await prisma.arm.findFirst({
    where: { classId: classRecord.id, name: armName, isActive: true }
  });
  if (!arm) throw new Error('Arm not found');

  const policy = await getEffectivePolicyForEntry(schoolId, className, subjectName);

  const entries = await prisma.assessmentEntry.findMany({
    where: { schoolId, className, subjectName, termId },
    include: {
      scores: { include: { student: { select: { id: true, firstName: true, lastName: true } } } }
    },
    orderBy: { createdAt: 'desc' }
  });

  const caComponents = policy.components.map(c => {
    const componentEntries = entries.filter(e => e.policyComponentId === c.id);
    const usedPoints = componentEntries.reduce((sum, e) => sum + e.contributionPoints, 0);
    return {
      componentId: c.id,
      componentName: c.name,
      maxScore: c.maxScore,
      usedPoints,
      entries: componentEntries.length
    };
  });

  const examEntries = entries.filter(e => e.componentType === 'exam');
  const examUsedPoints = examEntries.reduce((sum, e) => sum + e.contributionPoints, 0);

  const componentProgress = [
    ...caComponents,
    { componentId: 'exam', componentName: 'Exam', maxScore: policy.examMax, usedPoints: examUsedPoints, entries: examEntries.length }
  ];

  const allComplete = componentProgress.every(c => c.usedPoints === c.maxScore);
  const overallStatus = entries.length === 0 ? 'not_started'
    : allComplete ? 'completed'
    : 'in_progress';

  const teacherIds = [...new Set(entries.map(e => e.createdBy))];
  const teacherName = teacherIds.length > 0 ? await prisma.user.findUnique({ where: { id: teacherIds[0] }, select: { firstName: true, lastName: true } }) : null;

  const lastUpdated = entries.length > 0
    ? entries.reduce((latest, e) => e.updatedAt > latest ? e.updatedAt : latest, entries[0].updatedAt)
    : null;

  return {
    className,
    armName,
    subjectName,
    termId,
    teacherName: teacherName ? `${teacherName.firstName} ${teacherName.lastName}` : null,
    lastUpdated,
    overallStatus,
    policy: { name: policy.name, caComponents: policy.components.map(c => ({ id: c.id, name: c.name, maxScore: c.maxScore })), examMax: policy.examMax },
    componentProgress,
    entries: entries.map(e => ({
      id: e.id,
      title: e.title,
      assessmentType: e.assessmentType,
      componentName: e.componentType === 'exam' ? 'Exam' : (policy.components.find(c => c.id === e.policyComponentId)?.name || e.policyComponentId),
      componentId: e.policyComponentId,
      contributionPoints: e.contributionPoints,
      studentsGraded: e.scores.length,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt
    }))
  };
};

const getSubjectScores = async (schoolId, className, armName, subjectName, termId) => {
  const classRecord = await prisma.class.findFirst({
    where: { schoolId, name: className, isActive: true }
  });
  if (!classRecord) throw new Error('Class not found');

  const subjectRecord = await prisma.subject.findFirst({
    where: { schoolId, name: subjectName, isActive: true }
  });
  if (!subjectRecord) throw new Error('Subject not found');

  const policy = await getEffectivePolicyForEntry(schoolId, className, subjectName);

  const targetArms = armName
    ? await prisma.arm.findMany({ where: { classId: classRecord.id, name: armName, isActive: true } })
    : await prisma.arm.findMany({ where: { classId: classRecord.id, isActive: true } });
  if (targetArms.length === 0) throw new Error('Arm not found');

  const armIds = targetArms.map(a => a.id);

  const students = await prisma.student.findMany({
    where: {
      schoolId, isActive: true, isEnrolled: true,
      OR: [
        { armId: { in: armIds } },
        { classId: classRecord.id }
      ]
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
  });

  const entries = await prisma.assessmentEntry.findMany({
    where: { schoolId, className, subjectName, termId },
    include: { scores: true },
    orderBy: { createdAt: 'desc' }
  });

  const componentEntries = {};
  entries.forEach(entry => {
    const key = entry.policyComponentId;
    if (!componentEntries[key]) componentEntries[key] = [];
    componentEntries[key].push(entry);
  });

  const caComponents = policy.components.map(c => {
    const compEntries = entries.filter(e => e.policyComponentId === c.id);
    const usedPoints = compEntries.reduce((sum, e) => sum + e.contributionPoints, 0);
    return { id: c.id, name: c.name, maxScore: c.maxScore, usedPoints };
  });
  const examEntries = entries.filter(e => e.componentType === 'exam');
  const examUsedPoints = examEntries.reduce((sum, e) => sum + e.contributionPoints, 0);

  const allComplete = caComponents.every(c => c.usedPoints === c.maxScore)
    && examUsedPoints === policy.examMax;
  const overallStatus = entries.length === 0 ? 'not_started'
    : allComplete ? 'completed' : 'in_progress';

  const totalMaxScore = policy.components.reduce((sum, c) => sum + c.maxScore, 0) + policy.examMax;

  const studentScores = students.map(student => {
    const scores = {};
    let total = 0;
    let mostRecentAssessment = null;
    let hasAnyScore = false;

    policy.components.forEach(comp => {
      const compEntryList = componentEntries[comp.id] || [];
      let studentCompScore = 0;
      let mostRecentForComp = null;
      let hasCompScore = false;

      compEntryList.forEach(entry => {
        const sr = entry.scores.find(s => s.studentId === student.id);
        if (sr) {
          hasAnyScore = true;
          hasCompScore = true;
          studentCompScore += sr.scoreObtained;
          if (!mostRecentForComp || entry.createdAt > mostRecentForComp.createdAt) {
            mostRecentForComp = entry;
          }
        }
      });

      scores[comp.id] = hasCompScore ? studentCompScore : null;

      if (mostRecentForComp && (!mostRecentAssessment || mostRecentForComp.createdAt > mostRecentAssessment.createdAt)) {
        mostRecentAssessment = {
          title: mostRecentForComp.title,
          score: studentCompScore,
          maxScore: comp.maxScore,
          date: mostRecentForComp.createdAt
        };
      }

      const compScore = scores[comp.id] !== null ? scores[comp.id] : 0;
      total += compScore;
    });

    const examEntryList = componentEntries['exam'] || [];
    let studentExamScore = 0;
    let mostRecentExam = null;
    let hasExamScore = false;
    examEntryList.forEach(entry => {
      const sr = entry.scores.find(s => s.studentId === student.id);
      if (sr) {
        hasAnyScore = true;
        hasExamScore = true;
        studentExamScore += sr.scoreObtained;
        if (!mostRecentExam || entry.createdAt > mostRecentExam.createdAt) {
          mostRecentExam = entry;
        }
      }
    });
    scores['exam'] = hasExamScore ? studentExamScore : null;

    if (mostRecentExam && (!mostRecentAssessment || mostRecentExam.createdAt > mostRecentAssessment.createdAt)) {
      mostRecentAssessment = {
        title: mostRecentExam.title,
        score: studentExamScore,
        maxScore: policy.examMax,
        date: mostRecentExam.createdAt
      };
    }

    total += studentExamScore;

    let grade = 'Pending';
    if (overallStatus === 'completed') {
      const percentage = totalMaxScore > 0 ? (total / totalMaxScore) * 100 : 0;
      grade = percentage >= 75 ? 'A'
        : percentage >= 65 ? 'B'
        : percentage >= 50 ? 'C'
        : percentage >= 40 ? 'D'
        : 'F';
    }

    return {
      id: student.id,
      name: `${student.firstName} ${student.lastName}`,
      admissionNo: student.studentId,
      gender: student.gender,
      scores,
      mostRecentAssessment: hasAnyScore ? mostRecentAssessment : null,
      total,
      grade
    };
  });

  const studentsWithScores = studentScores.filter(s => s.mostRecentAssessment !== null);
  const averageScore = studentsWithScores.length > 0
    ? Math.round((studentsWithScores.reduce((sum, s) => sum + s.total, 0) / studentsWithScores.length) * 100) / 100
    : 0;

  return {
    overallStatus,
    studentCount: students.length,
    averageScore,
    policy: {
      caComponents: policy.components.map(c => ({ id: c.id, name: c.name, maxScore: c.maxScore })),
      examMax: policy.examMax
    },
    students: studentScores
  };
};

module.exports = {
  listEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  saveScores,
  getGradingActivity,
  getSubjectScores
};
