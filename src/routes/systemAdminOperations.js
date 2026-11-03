const express = require('express');
const { body, param, query } = require('express-validator');
const { handleValidationErrors, validateSystemAdminPermission } = require('../middleware/systemAdminValidation');
const { createCustomLimiter } = require('../middleware/rateLimiter');
const catchAsync = require('../utils/catchAsync');
const service = require('../services/systemAdminOperationsService');
const audit = require('../services/platformAuditService');

// Mounted only after requireSystemAdmin + validateCrossSchoolAccess in the
// parent router. Never impersonates a school admin or changes req.user.schoolId.
const router = express.Router();
const school = () => param('schoolId').matches(/^[A-Z]{3}\d{4}$/).withMessage('A generated school code is required');
const reason = () => body('reason').isString().bail().trim().isLength({ min: 10, max: 500 });
const pagination = () => [
  query('page').optional().isInt({ min: 1, max: 100000 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString().bail().trim().isLength({ max: 100 }),
  query('status').optional().isIn(['', 'active', 'inactive'])
];
const collection = () => param('collection').isIn(Object.keys(service.collections));
const editable = () => param('collection').isIn(['classes', 'subjects']);
const actor = req => req.user.email;
const context = req => audit.contextFromRequest(req);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
router.use(createCustomLimiter({ windowMs: 60 * 1000, max: 100 }));

router.get('/operations/capabilities', (req, res) => ok(res, { version: 1, schoolSearch: true, collections: Object.keys(service.collections), academicManagement: true, adminEmail: true, schoolConfiguration: true }));
router.get('/operations/school-status', validateSystemAdminPermission('read_schools'), catchAsync(async (req, res) => ok(res, await service.statusCounts())));
router.get('/schools/:schoolId/operations/summary', validateSystemAdminPermission('read_schools'), school(), handleValidationErrors,
  catchAsync(async (req, res) => ok(res, await service.summary(req.params.schoolId))));
router.get('/schools/:schoolId/operations/configuration', validateSystemAdminPermission('read_schools'), school(), handleValidationErrors,
  catchAsync(async (req, res) => ok(res, await service.configuration(req.params.schoolId))));
router.put('/schools/:schoolId/operations/configuration', validateSystemAdminPermission('manage_schools'), school(), reason(),
  body('version').isISO8601(),
  body('subscriptionTier').isIn(['basic', 'standard', 'premium', 'enterprise']),
  body('subscriptionStatus').isIn(['trial', 'active', 'suspended', 'cancelled']),
  body('limits').isObject(),
  ...['maxUsers', 'maxStudents', 'maxStorage'].map(key => body(`limits.${key}`).optional().isInt({ min: 0, max: 100000000 })),
  body('features').optional().isArray({ max: 100 }),
  body('features.*.featureName').isString().bail().isLength({ min: 1, max: 100 }),
  body('features.*.isEnabled').isBoolean({ strict: true }), handleValidationErrors,
  catchAsync(async (req, res) => {
    const data = await service.saveConfiguration(req.params.schoolId, req.body, actor(req), context(req));
    await require('../services/cacheService').invalidatePlatformCachesForSchool(req.params.schoolId).catch(() => {});
    ok(res, data);
  }));
router.get('/schools/:schoolId/operations/:collection', validateSystemAdminPermission('read_schools'), school(), collection(), ...pagination(), handleValidationErrors,
  catchAsync(async (req, res) => ok(res, await service.list(req.params.schoolId, req.params.collection, req.query))));
router.post('/schools/:schoolId/operations/:collection', validateSystemAdminPermission('manage_schools'), school(), editable(), reason(),
  body('name').isString().bail().trim().isLength({ min: 2, max: 100 }),
  body('baseLevel').optional().isString().bail().trim().isLength({ max: 50 }),
  body('level').optional().isInt({ min: 0, max: 100 }),
  body('code').if((_, { req }) => req.params.collection === 'subjects').isString().bail().trim().isLength({ min: 1, max: 30 }).matches(/^[A-Za-z0-9_-]+$/),
  body('category').optional().isIn(['core', 'elective']),
  body('description').optional().isString().bail().trim().isLength({ max: 1000 }), handleValidationErrors,
  catchAsync(async (req, res) => ok(res, await service.changeAcademic(req.params.schoolId, req.params.collection, null, req.body, actor(req), context(req)), 201)));
router.put('/schools/:schoolId/operations/:collection/:recordId', validateSystemAdminPermission('manage_schools'), school(), editable(),
  param('recordId').isUUID(), reason(), body('isActive').isBoolean({ strict: true }), handleValidationErrors,
  catchAsync(async (req, res) => ok(res, await service.changeAcademic(req.params.schoolId, req.params.collection, req.params.recordId, req.body, actor(req), context(req)))));
router.post('/schools/:schoolId/admin-messages', createCustomLimiter({ windowMs: 10 * 60 * 1000, max: 20 }),
  validateSystemAdminPermission('manage_users'), school(),
  body('requestId').isUUID(), body('userId').isUUID(),
  body('title').isString().bail().trim().isLength({ min: 3, max: 160 }).not().matches(/[\r\n]/),
  body('body').isString().bail().trim().isLength({ min: 10, max: 4000 }), handleValidationErrors,
  catchAsync(async (req, res) => ok(res, await service.messageAdmin(req.params.schoolId, req.body, actor(req), context(req)))));

module.exports = router;
