const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const {
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
} = require('../controllers/reportCardController');

router.use(authenticateToken);
router.use(requireRole(['admin']));

// Result publishing
router.get('/results/publish-status', getPublishStatus);
router.post('/results/publish', publishResults);
router.post('/results/generate-pdfs', generatePdfs);
router.get('/results/pdf-jobs/:jobId', getPdfJob);
router.get('/results/pdf-jobs/:jobId/download', downloadPdf);

// Report card template
router.get('/report-cards/template', getTemplate);
router.put('/report-cards/template', saveTemplate);

// Report card comments
router.get('/report-cards/comments', getComments);
router.put('/report-cards/comments/:studentId', saveComment);

// Report card generate, sign-off, publish
router.post('/report-cards/generate', generateReportCards);
router.post('/report-cards/sign-off', signOff);
router.post('/report-cards/publish', publishToParents);

module.exports = router;
