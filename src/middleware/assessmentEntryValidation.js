const { body, query, param, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

const validateListEntries = [
  query('className').notEmpty().withMessage('className is required'),
  query('subjectName').notEmpty().withMessage('subjectName is required'),
  query('termId').notEmpty().withMessage('termId is required'),
  handleValidationErrors
];

const validateCreateEntry = [
  body('policyComponentId').notEmpty().withMessage('policyComponentId is required'),
  body('componentType').isIn(['ca', 'exam']).withMessage('componentType must be ca or exam'),
  body('title').trim().notEmpty().withMessage('title is required').isLength({ max: 100 }).withMessage('title must be 100 characters or less'),
  body('assessmentType').trim().notEmpty().withMessage('assessmentType is required'),
  body('className').notEmpty().withMessage('className is required'),
  body('subjectName').notEmpty().withMessage('subjectName is required'),
  body('termId').notEmpty().withMessage('termId is required'),
  body('maxObtainableScore').isFloat({ gt: 0 }).withMessage('maxObtainableScore must be > 0'),
  body('contributionPoints').isFloat({ gt: 0 }).withMessage('contributionPoints must be > 0'),
  handleValidationErrors
];

const validateUpdateEntry = [
  param('id').isUUID().withMessage('Invalid entry ID'),
  body('title').optional().trim().notEmpty().withMessage('title cannot be empty').isLength({ max: 100 }).withMessage('title must be 100 characters or less'),
  body('assessmentType').optional().trim().notEmpty().withMessage('assessmentType cannot be empty'),
  body('maxObtainableScore').optional().isFloat({ gt: 0 }).withMessage('maxObtainableScore must be > 0'),
  body('contributionPoints').optional().isFloat({ gt: 0 }).withMessage('contributionPoints must be > 0'),
  handleValidationErrors
];

const validateEntryId = [
  param('id').isUUID().withMessage('Invalid entry ID'),
  handleValidationErrors
];

const validateSaveScores = [
  param('id').isUUID().withMessage('Invalid entry ID'),
  body('scores').isArray().withMessage('scores must be an array'),
  body('scores.*.studentId').notEmpty().withMessage('Each score must have a studentId'),
  body('scores.*.scoreObtained').isFloat({ min: 0 }).withMessage('Each scoreObtained must be >= 0'),
  handleValidationErrors
];

const validateGradingActivity = [
  query('className').notEmpty().withMessage('className is required'),
  query('armName').notEmpty().withMessage('armName is required'),
  query('subjectName').notEmpty().withMessage('subjectName is required'),
  query('termId').notEmpty().withMessage('termId is required'),
  handleValidationErrors
];

const validateSubjectScores = [
  query('className').notEmpty().withMessage('className is required'),
  query('armName').optional({ values: 'falsy' }),
  query('subjectName').notEmpty().withMessage('subjectName is required'),
  query('termId').notEmpty().withMessage('termId is required'),
  handleValidationErrors
];

module.exports = {
  validateListEntries,
  validateCreateEntry,
  validateUpdateEntry,
  validateEntryId,
  validateSaveScores,
  validateGradingActivity,
  validateSubjectScores
};
