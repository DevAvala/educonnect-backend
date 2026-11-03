/**
 * System Admin Routes
 * Main routes for system administration functionality
 * Handles platform management, school management, and cross-school operations
 */

const express = require('express');
const router = express.Router();

// Import controllers
const {
  getPlatformOverview,
  getSystemHealth,
  getPlatformKPIs,
  getCrossSchoolMetrics,
  getSchoolManagement,
  createSchool,
  updateSchoolConfig,
  deactivateSchool,
  reactivateSchool,
  getUserManagement,
  manageUserAccess,
  getSecurityAlerts
} = require('../controllers/systemAdminController');

// Import middleware
const {
  requireSystemAdmin,
  validateCrossSchoolAccess,
  auditSystemOperation,
  completeAuditLog
} = require('../middleware/systemAdminAuth');
const {
  validateSystemAdminPermission,
  createSystemAdminValidationChain
} = require('../middleware/systemAdminValidation');
const { createCustomLimiter } = require('../middleware/rateLimiter');
const {
  getSchoolDetail,
  listSchoolStudents,
  listSchoolStaff,
  listAuditLogs,
  archiveSchool,
  restoreSchool,
  deleteSchool,
  removeUser,
  removeStudent,
  importStudents,
  importStaff,
  studentTemplate,
  staffTemplate,
  inviteImportedStaff
} = require('../controllers/systemAdminSchoolController');
const ops = require('../middleware/systemAdminOpsValidation');
const { csvUpload } = require('../middleware/csvUpload');

// Apply system admin authentication to all routes
router.use(requireSystemAdmin);
router.use(validateCrossSchoolAccess);
router.use(completeAuditLog);

// ============================================================================
// PLATFORM OVERVIEW ENDPOINTS
// ============================================================================

/**
 * @route   GET /api/system-admin/platform/overview
 * @desc    Get comprehensive platform overview
 * @access  System Admin Only
 * @permission view_analytics
 */
router.get('/platform/overview',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 30 }), // 30 requests per minute
  validateSystemAdminPermission('view_analytics'),
  auditSystemOperation('platform_overview_access'),
  getPlatformOverview
);

/**
 * @route   GET /api/system-admin/system/health
 * @desc    Get detailed system health metrics
 * @access  System Admin Only
 * @permission view_analytics
 */
router.get('/system/health',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 60 }), // 60 requests per minute
  validateSystemAdminPermission('view_analytics'),
  auditSystemOperation('system_health_access'),
  getSystemHealth
);

/**
 * @route   GET /api/system-admin/platform/kpis
 * @desc    Get platform key performance indicators
 * @access  System Admin Only
 * @permission view_analytics
 */
router.get('/platform/kpis',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 30 }), // 30 requests per minute
  validateSystemAdminPermission('view_analytics'),
  auditSystemOperation('platform_kpis_access'),
  getPlatformKPIs
);

/**
 * @route   GET /api/system-admin/metrics/cross-school
 * @desc    Get cross-school aggregated metrics
 * @access  System Admin Only
 * @permission view_analytics
 */
router.get('/metrics/cross-school',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 40 }), // 40 requests per minute
  validateSystemAdminPermission('view_analytics'),
  auditSystemOperation('cross_school_metrics_access'),
  getCrossSchoolMetrics
);

// ============================================================================
// SCHOOL MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * @route   GET /api/system-admin/schools/management
 * @desc    Get school management data with pagination and filtering
 * @access  System Admin Only
 * @permission read_schools
 */
router.get('/schools/management',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 60 }), // 60 requests per minute
  validateSystemAdminPermission('read_schools'),
  auditSystemOperation('school_management_access'),
  getSchoolManagement
);

/**
 * @route   POST /api/system-admin/schools
 * @desc    Create new school
 * @access  System Admin Only
 * @permission manage_schools
 */
router.post('/schools',
  createCustomLimiter({ windowMs: 5 * 60 * 1000, max: 10 }), // 10 creates per 5 minutes
  validateSystemAdminPermission('manage_schools'),
  ...ops.validateCreateSchool,
  auditSystemOperation('school_creation'),
  createSchool
);

/**
 * @route   PUT /api/system-admin/schools/:schoolId/config
 * @desc    Update school configuration
 * @access  System Admin Only
 * @permission manage_schools
 */
router.put('/schools/:schoolId/config',
  createCustomLimiter({ windowMs: 5 * 60 * 1000, max: 20 }), // 20 updates per 5 minutes
  validateSystemAdminPermission('manage_schools'),
  ...createSystemAdminValidationChain('school_config_update', 'manage_schools'),
  auditSystemOperation('school_config_update'),
  updateSchoolConfig
);

/**
 * @route   PUT /api/system-admin/schools/:schoolId/deactivate
 * @desc    Deactivate school (soft delete)
 * @access  System Admin Only
 * @permission manage_schools
 */
router.put('/schools/:schoolId/deactivate',
  createCustomLimiter({ windowMs: 10 * 60 * 1000, max: 5 }), // 5 deactivations per 10 minutes
  validateSystemAdminPermission('manage_schools'),
  ...ops.validateStatusChange,
  auditSystemOperation('school_deactivation'),
  deactivateSchool
);

/**
 * @route   PUT /api/system-admin/schools/:schoolId/reactivate
 * @desc    Reactivate previously deactivated school
 * @access  System Admin Only
 * @permission manage_schools
 */
router.put('/schools/:schoolId/reactivate',
  createCustomLimiter({ windowMs: 10 * 60 * 1000, max: 5 }), // 5 reactivations per 10 minutes
  validateSystemAdminPermission('manage_schools'),
  ...ops.validateStatusChange,
  auditSystemOperation('school_reactivation'),
  reactivateSchool
);

// ============================================================================
// SCHOOL OVERSIGHT, ARCHIVE / RESTORE / PURGE
// ============================================================================

/**
 * @route   GET /api/system-admin/schools/:schoolId
 * @desc    Full picture of one school: profile, admin, headcounts, archive state
 * @permission read_schools
 */
router.get('/schools/:schoolId',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 60 }),
  validateSystemAdminPermission('read_schools'),
  ...ops.validateSchoolOnly,
  auditSystemOperation('school_detail_access'),
  getSchoolDetail
);

/**
 * @route   GET /api/system-admin/schools/:schoolId/students
 * @desc    A school's students (paginated, searchable)
 * @permission read_schools
 */
router.get('/schools/:schoolId/students',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 60 }),
  validateSystemAdminPermission('read_schools'),
  ...ops.validateListStudents,
  auditSystemOperation('school_students_access'),
  listSchoolStudents
);

/**
 * @route   GET /api/system-admin/schools/:schoolId/staff
 * @desc    A school's teachers and admins, with invitation status
 * @permission read_schools
 */
router.get('/schools/:schoolId/staff',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 60 }),
  validateSystemAdminPermission('read_schools'),
  ...ops.validateListStaff,
  auditSystemOperation('school_staff_access'),
  listSchoolStaff
);

/**
 * @route   POST /api/system-admin/schools/:schoolId/archive
 * @desc    "Remove" a school: lock everyone out, keep all data, restorable
 * @permission manage_schools
 */
router.post('/schools/:schoolId/archive',
  createCustomLimiter({ windowMs: 10 * 60 * 1000, max: 5 }),
  validateSystemAdminPermission('manage_schools'),
  ...ops.validateArchive,
  auditSystemOperation('school_archive'),
  archiveSchool
);

/**
 * @route   POST /api/system-admin/schools/:schoolId/restore
 * @desc    Bring an archived school back
 * @permission manage_schools
 */
router.post('/schools/:schoolId/restore',
  createCustomLimiter({ windowMs: 10 * 60 * 1000, max: 5 }),
  validateSystemAdminPermission('manage_schools'),
  ...ops.validateRestore,
  auditSystemOperation('school_restore'),
  restoreSchool
);

/**
 * @route   DELETE /api/system-admin/schools/:schoolId
 * @desc    Delete a school: sets isDeleted. It is hidden and locked, nothing is erased, and it can be restored.
 * @body    { reason, confirmSchoolName }
 * @permission manage_schools
 */
router.delete('/schools/:schoolId',
  createCustomLimiter({ windowMs: 10 * 60 * 1000, max: 5 }),
  validateSystemAdminPermission('manage_schools'),
  ...ops.validateDelete,
  auditSystemOperation('school_delete'),
  deleteSchool
);

// ============================================================================
// REMOVING PEOPLE
// ============================================================================

/**
 * @route   DELETE /api/system-admin/schools/:schoolId/users/:userId
 * @desc    Close an account and erase the person's details (records are kept)
 * @permission manage_users
 */
router.delete('/schools/:schoolId/users/:userId',
  createCustomLimiter({ windowMs: 5 * 60 * 1000, max: 20 }),
  validateSystemAdminPermission('manage_users'),
  ...ops.validateRemoveUser,
  auditSystemOperation('user_removal'),
  removeUser
);

/**
 * @route   DELETE /api/system-admin/schools/:schoolId/students/:studentId
 * @desc    Erase a student's details (records are kept)
 * @permission manage_users
 */
router.delete('/schools/:schoolId/students/:studentId',
  createCustomLimiter({ windowMs: 5 * 60 * 1000, max: 20 }),
  validateSystemAdminPermission('manage_users'),
  ...ops.validateRemoveStudent,
  auditSystemOperation('student_removal'),
  removeStudent
);

// ============================================================================
// CSV IMPORT AND INVITATIONS
// ============================================================================

/**
 * @route   GET /api/system-admin/import/templates/students  (and /staff)
 * @desc    Download a CSV template with the accepted columns
 * @permission manage_users
 */
router.get('/import/templates/students', validateSystemAdminPermission('manage_users'), studentTemplate);
router.get('/import/templates/staff', validateSystemAdminPermission('manage_users'), staffTemplate);

/**
 * @route   POST /api/system-admin/schools/:schoolId/import/students?dryRun=true
 * @desc    Import students from a CSV (multipart field "file"). Records only, no logins.
 * @permission manage_users
 */
router.post('/schools/:schoolId/import/students',
  createCustomLimiter({ windowMs: 10 * 60 * 1000, max: 10 }),
  validateSystemAdminPermission('manage_users'),
  ...ops.validateImport,
  ...csvUpload,
  auditSystemOperation('student_import'),
  importStudents
);

/**
 * @route   POST /api/system-admin/schools/:schoolId/import/staff?dryRun=true
 * @desc    Import teachers from a CSV (multipart field "file"). Records only, invite them afterwards.
 * @permission manage_users
 */
router.post('/schools/:schoolId/import/staff',
  createCustomLimiter({ windowMs: 10 * 60 * 1000, max: 10 }),
  validateSystemAdminPermission('manage_users'),
  ...ops.validateImport,
  ...csvUpload,
  auditSystemOperation('staff_import'),
  importStaff
);

/**
 * @route   POST /api/system-admin/schools/:schoolId/staff/invite
 * @desc    Invite imported teachers (all, or the listed userIds). Claims the imported records.
 * @permission manage_users
 */
router.post('/schools/:schoolId/staff/invite',
  createCustomLimiter({ windowMs: 10 * 60 * 1000, max: 10 }),
  validateSystemAdminPermission('manage_users'),
  ...ops.validateInviteStaff,
  auditSystemOperation('staff_invite'),
  inviteImportedStaff
);

// ============================================================================
// AUDIT TRAIL
// ============================================================================

/**
 * @route   GET /api/system-admin/audit-logs
 * @desc    The durable record of everything system admins have done
 * @permission view_audit_logs
 */
router.get('/audit-logs',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 60 }),
  validateSystemAdminPermission('view_audit_logs'),
  ...ops.validateAuditQuery,
  auditSystemOperation('audit_log_access'),
  listAuditLogs
);

// ============================================================================
// USER MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * @route   GET /api/system-admin/users/management
 * @desc    Get cross-school user management data
 * @access  System Admin Only
 * @permission manage_users
 */
router.get('/users/management',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 60 }), // 60 requests per minute
  validateSystemAdminPermission('manage_users'),
  auditSystemOperation('user_management_access'),
  getUserManagement
);

/**
 * @route   PUT /api/system-admin/users/:userId/access
 * @desc    Manage user access permissions across schools
 * @access  System Admin Only
 * @permission manage_users
 */
router.put('/users/:userId/access',
  createCustomLimiter({ windowMs: 5 * 60 * 1000, max: 20 }), // 20 updates per 5 minutes
  validateSystemAdminPermission('manage_users'),
  ...createSystemAdminValidationChain('user_management', 'manage_users'),
  auditSystemOperation('user_access_management'),
  manageUserAccess
);

/**
 * @route   GET /api/system-admin/security/alerts
 * @desc    Get security alerts and monitoring information
 * @access  System Admin Only
 * @permission view_security
 */
router.get('/security/alerts',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 60 }), // 60 requests per minute
  validateSystemAdminPermission('view_security'),
  auditSystemOperation('security_alerts_access'),
  getSecurityAlerts
);

// ============================================================================
// HEALTH CHECK AND STATUS ENDPOINTS
// ============================================================================

/**
 * @route   GET /api/system-admin/health
 * @desc    Health check endpoint for system admin API
 * @access  System Admin Only
 */
router.get('/health',
  createCustomLimiter({ windowMs: 1 * 60 * 1000, max: 60 }), // 60 requests per minute
  (req, res) => {
    res.status(200).json({
      success: true,
      message: 'System Admin API is healthy',
      timestamp: new Date(),
      systemAdmin: {
        email: req.user.email,
        accessLevel: req.user.systemAdminLevel
      },
      endpoints: {
        platform: {
          overview: '/api/system-admin/platform/overview',
          kpis: '/api/system-admin/platform/kpis',
          health: '/api/system-admin/system/health'
        },
        schools: {
          management: '/api/system-admin/schools/management',
          create: '/api/system-admin/schools',
          updateConfig: '/api/system-admin/schools/:schoolId/config',
          deactivate: '/api/system-admin/schools/:schoolId/deactivate',
          reactivate: '/api/system-admin/schools/:schoolId/reactivate'
        },
        users: {
          management: '/api/system-admin/users/management',
          manageAccess: '/api/system-admin/users/:userId/access'
        },
        security: {
          alerts: '/api/system-admin/security/alerts'
        },
        metrics: {
          crossSchool: '/api/system-admin/metrics/cross-school'
        }
      }
    });
  }
);

module.exports = router;