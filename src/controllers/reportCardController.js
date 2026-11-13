const reportCardService = require('../services/reportCardService');
const logger = require('../utils/logger');

// ===== RESULT PUBLISHING =====

const getPublishStatus = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { termId, classId } = req.query;

    if (!termId || !classId) {
      return res.status(400).json({ success: false, message: 'termId and classId are required' });
    }

    const data = await reportCardService.getPublishStatus(schoolId, termId, classId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error fetching publish status:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch publish status' });
  }
};

const publishResults = async (req, res) => {
  try {
    const { schoolId, userId } = req.user;
    const { termId, classId } = req.body;

    if (!termId || !classId) {
      return res.status(400).json({ success: false, message: 'termId and classId are required' });
    }

    const data = await reportCardService.publishResults(schoolId, termId, classId, userId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error publishing results:', error);
    res.status(500).json({ success: false, message: 'Failed to publish results' });
  }
};

const generatePdfs = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { termId, classId } = req.body;

    if (!termId || !classId) {
      return res.status(400).json({ success: false, message: 'termId and classId are required' });
    }

    const data = await reportCardService.createPdfJob(schoolId, 'results', { termId, classId });
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error generating PDFs:', error);
    res.status(500).json({ success: false, message: 'Failed to generate PDFs' });
  }
};

const getPdfJob = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { jobId } = req.params;

    const data = await reportCardService.getPdfJob(schoolId, jobId);
    if (!data) {
      return res.status(404).json({ success: false, message: 'PDF job not found' });
    }

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error fetching PDF job:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch PDF job' });
  }
};

const downloadPdf = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { jobId } = req.params;

    const result = await reportCardService.downloadPdf(schoolId, jobId);
    if (result.notFound) {
      return res.status(404).json({ success: false, message: 'PDF job not found' });
    }
    if (!result.downloadUrl) {
      return res.status(400).json({ success: false, message: result.message || 'No download URL available' });
    }

    if (result.isLocal) {
      return res.download(result.filePath, `${jobId}.pdf`);
    }

    res.redirect(result.downloadUrl);
  } catch (error) {
    logger.error('Error downloading PDF:', error);
    res.status(500).json({ success: false, message: 'Failed to download PDF' });
  }
};

// ===== REPORT CARD TEMPLATE =====

const getTemplate = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const template = await reportCardService.getTemplate(schoolId);
    res.json({ success: true, data: { template } });
  } catch (error) {
    logger.error('Error fetching report card template:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch template' });
  }
};

const saveTemplate = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const template = await reportCardService.saveTemplate(schoolId, req.body);
    res.json({ success: true, data: { template } });
  } catch (error) {
    logger.error('Error saving report card template:', error);
    res.status(500).json({ success: false, message: 'Failed to save template' });
  }
};

// ===== REPORT CARD COMMENTS =====

const getComments = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { armId, termId } = req.query;

    if (!armId || !termId) {
      return res.status(400).json({ success: false, message: 'armId and termId are required' });
    }

    const data = await reportCardService.getCommentsWorklist(schoolId, armId, termId);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Arm not found' });
    }

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error fetching comments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch comments' });
  }
};

const saveComment = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { studentId } = req.params;

    const data = await reportCardService.saveComment(schoolId, studentId, req.body);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error saving comment:', error);
    res.status(500).json({ success: false, message: 'Failed to save comment' });
  }
};

// ===== REPORT CARD GENERATE =====

const generateReportCards = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { armId, termId } = req.body;

    if (!armId || !termId) {
      return res.status(400).json({ success: false, message: 'armId and termId are required' });
    }

    const data = await reportCardService.generateReportCards(schoolId, armId, termId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error generating report cards:', error);
    res.status(500).json({ success: false, message: 'Failed to generate report cards' });
  }
};

// ===== REPORT CARD SIGN-OFF =====

const signOff = async (req, res) => {
  try {
    const { schoolId, userId } = req.user;
    const { armId, termId } = req.body;

    if (!armId || !termId) {
      return res.status(400).json({ success: false, message: 'armId and termId are required' });
    }

    const data = await reportCardService.signOff(schoolId, armId, termId, userId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error signing off report cards:', error);
    res.status(500).json({ success: false, message: 'Failed to sign off' });
  }
};

// ===== REPORT CARD PUBLISH TO PARENTS =====

const publishToParents = async (req, res) => {
  try {
    const { schoolId, userId } = req.user;
    const { armId, termId, studentIds } = req.body;

    if (!armId || !termId) {
      return res.status(400).json({ success: false, message: 'armId and termId are required' });
    }

    const data = await reportCardService.publishToParents(schoolId, armId, termId, userId, studentIds);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error publishing report cards:', error);
    res.status(500).json({ success: false, message: 'Failed to publish report cards' });
  }
};

module.exports = {
  getPublishStatus,
  publishResults,
  generatePdfs,
  getPdfJob,
  downloadPdf,
  getTemplate,
  saveTemplate,
  getComments,
  saveComment,
  generateReportCards,
  signOff,
  publishToParents
};
