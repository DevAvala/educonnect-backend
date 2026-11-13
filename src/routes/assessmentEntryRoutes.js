const express = require('express');
const router = express.Router();
const controller = require('../controllers/assessmentEntryController');
const {
  validateListEntries,
  validateCreateEntry,
  validateUpdateEntry,
  validateEntryId,
  validateSaveScores,
  validateGradingActivity,
  validateSubjectScores
} = require('../middleware/assessmentEntryValidation');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// ── Teacher routes ───────────────────────────────────────────
router.use('/teacher', authenticateToken);
router.use('/teacher', requireRole(['teacher']));

router.get('/teacher/assessment-entries', validateListEntries, controller.list);
router.post('/teacher/assessment-entries', validateCreateEntry, controller.create);
router.put('/teacher/assessment-entries/:id', validateUpdateEntry, controller.update);
router.delete('/teacher/assessment-entries/:id', validateEntryId, controller.remove);
router.post('/teacher/assessment-entries/:id/scores', validateSaveScores, controller.saveScores);

// ── Admin routes ─────────────────────────────────────────────
router.use('/admin', authenticateToken);
router.use('/admin', requireRole(['admin']));

router.get('/admin/grading-activity', validateGradingActivity, controller.gradingActivity);
router.get('/admin/grading/subject-scores', validateSubjectScores, controller.subjectScores);

module.exports = router;
