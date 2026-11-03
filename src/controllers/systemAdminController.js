/**
 * System Admin Controller
 * Handles system administration endpoints for platform-wide operations
 * Requirements: 1.1, 1.3, 7.2
 */

const catchAsync = require('../utils/catchAsync');
const SystemAdminService = require('../services/systemAdminService');
const CrossSchoolAggregator = require('../services/crossSchoolAggregator');
const { logSystemAdminActivity } = require('../services/authService');
const { contextFromRequest } = require('../services/platformAuditService');
const logger = require('../utils/logger');

/**
 * Get Platform Overview
 * GET /api/system-admin/platform/overview
 * Provides comprehensive platform-wide metrics and status
 */
const getPlatformOverview = catchAsync(async (req, res) => {
  try {
    // Log the operation
    await logSystemAdminActivity(req.user.email, 'platform_overview_accessed', {
      endpoint: req.path,
      method: req.method,
      severity: 'low'
    });

    // Get platform overview from SystemAdminService
    const overview = await SystemAdminService.getPlatformOverview();

    res.status(200).json({
      success: true,
      message: 'Platform overview retrieved successfully',
      data: overview,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Platform overview error:', error);
    
    // Log the error
    await logSystemAdminActivity(req.user.email, 'platform_overview_error', {
      error: error.message,
      endpoint: req.path,
      severity: 'medium'
    });

    res.status(500).json({
      success: false,
      message: 'Failed to retrieve platform overview',
      code: 'PLATFORM_OVERVIEW_ERROR',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get System Health
 * GET /api/system-admin/system/health
 * Provides detailed system health metrics and status
 */
const getSystemHealth = catchAsync(async (req, res) => {
  try {
    // Log the operation
    await logSystemAdminActivity(req.user.email, 'system_health_accessed', {
      endpoint: req.path,
      method: req.method,
      severity: 'low'
    });

    // Get system health metrics
    const healthMetrics = await SystemAdminService.getSystemHealth();

    // Determine overall health status
    const overallStatus = determineOverallHealthStatus(healthMetrics);

    res.status(200).json({
      success: true,
      message: 'System health retrieved successfully',
      data: {
        ...healthMetrics,
        overallStatus,
        lastChecked: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('System health error:', error);
    
    // Log the error
    await logSystemAdminActivity(req.user.email, 'system_health_error', {
      error: error.message,
      endpoint: req.path,
      severity: 'high'
    });

    res.status(500).json({
      success: false,
      message: 'Failed to retrieve system health',
      code: 'SYSTEM_HEALTH_ERROR',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get Platform KPIs
 * GET /api/system-admin/platform/kpis
 * Provides key performance indicators for the platform
 */
const getPlatformKPIs = catchAsync(async (req, res) => {
  try {
    const { timeRange } = req.query;
    
    // Parse time range if provided
    const parsedTimeRange = parseTimeRange(timeRange);

    // Log the operation
    await logSystemAdminActivity(req.user.email, 'platform_kpis_accessed', {
      endpoint: req.path,
      method: req.method,
      timeRange: parsedTimeRange,
      severity: 'low'
    });

    // Get platform KPIs
    const kpis = await CrossSchoolAggregator.calculatePlatformKPIs(parsedTimeRange);

    res.status(200).json({
      success: true,
      message: 'Platform KPIs retrieved successfully',
      data: kpis
    });

  } catch (error) {
    logger.error('Platform KPIs error:', error);
    
    // Log the error
    await logSystemAdminActivity(req.user.email, 'platform_kpis_error', {
      error: error.message,
      endpoint: req.path,
      severity: 'medium'
    });

    res.status(500).json({
      success: false,
      message: 'Failed to retrieve platform KPIs',
      code: 'PLATFORM_KPIS_ERROR',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get Cross-School Metrics
 * GET /api/system-admin/metrics/cross-school
 * Provides aggregated metrics across all schools
 */
const getCrossSchoolMetrics = catchAsync(async (req, res) => {
  try {
    const { metric = 'overview', schoolIds, timeRange } = req.query;
    
    // Parse parameters
    const parsedSchoolIds = schoolIds ? schoolIds.split(',') : null;
    const parsedTimeRange = parseTimeRange(timeRange);

    // Log the operation
    await logSystemAdminActivity(req.user.email, 'cross_school_metrics_accessed', {
      endpoint: req.path,
      method: req.method,
      metric,
      schoolIds: parsedSchoolIds,
      timeRange: parsedTimeRange,
      severity: 'low'
    });

    // Get cross-school metrics
    const metrics = await CrossSchoolAggregator.aggregateMetrics(
      parsedSchoolIds,
      metric,
      parsedTimeRange
    );

    res.status(200).json({
      success: true,
      message: 'Cross-school metrics retrieved successfully',
      data: metrics
    });

  } catch (error) {
    logger.error('Cross-school metrics error:', error);
    
    // Log the error
    await logSystemAdminActivity(req.user.email, 'cross_school_metrics_error', {
      error: error.message,
      endpoint: req.path,
      severity: 'medium'
    });

    res.status(500).json({
      success: false,
      message: 'Failed to retrieve cross-school metrics',
      code: 'CROSS_SCHOOL_METRICS_ERROR',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Determine overall health status based on individual metrics
 * @param {Object} healthMetrics - Health metrics from SystemAdminService
 * @returns {string} Overall health status
 */
const determineOverallHealthStatus = (healthMetrics) => {
  try {
    const { database, cache, services, alerts } = healthMetrics;

    // Check critical components
    if (!database?.connected || !cache?.connected) {
      return 'critical';
    }

    // Check for high-severity alerts
    if (alerts?.critical > 0) {
      return 'warning';
    }

    // Check service health
    const unhealthyServices = services?.filter(service => service.status !== 'healthy') || [];
    if (unhealthyServices.length > 0) {
      return 'warning';
    }

    // Check for moderate alerts
    if (alerts?.warning > 5) {
      return 'warning';
    }

    return 'healthy';

  } catch (error) {
    logger.error('Error determining health status:', error);
    return 'unknown';
  }
};

/**
 * Parse time range query parameter
 * @param {string} timeRange - Time range string (e.g., '7d', '30d', '1h')
 * @returns {Object} Parsed time range object
 */
const parseTimeRange = (timeRange) => {
  if (!timeRange) return {};

  try {
    const now = new Date();
    let startDate, endDate = now;

    switch (timeRange) {
      case '1h':
        startDate = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        return {};
    }

    return { startDate, endDate };

  } catch (error) {
    logger.error('Error parsing time range:', error);
    return {};
  }
};

/**
 * Handle cross-school operation errors
 * Centralized error handling for cross-school operations
 * @param {Error} error - The error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} operation - The operation that failed
 */
const handleCrossSchoolError = async (error, req, res, operation) => {
  logger.error(`Cross-school ${operation} error:`, error);

  // Log the error for audit purposes
  await logSystemAdminActivity(req.user.email, `cross_school_${operation}_error`, {
    error: error.message,
    endpoint: req.path,
    method: req.method,
    severity: 'high'
  });

  // Determine error type and response
  let statusCode = 500;
  let errorCode = 'CROSS_SCHOOL_ERROR';
  let message = `Failed to perform cross-school ${operation}`;

  if (error.isOperational && error.statusCode) {
    // A deliberate, already-worded failure from a service (not found, conflict, ...)
    statusCode = error.statusCode;
    errorCode = error.code || errorCode;
    message = error.message;
  } else if (error.message.includes('permission')) {
    statusCode = 403;
    errorCode = 'INSUFFICIENT_PERMISSIONS';
    message = 'Insufficient permissions for cross-school operation';
  } else if (error.message.includes('not found')) {
    statusCode = 404;
    errorCode = 'RESOURCE_NOT_FOUND';
    message = 'Requested resource not found';
  } else if (error.message.includes('validation')) {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = 'Invalid request parameters';
  }

  res.status(statusCode).json({
    success: false,
    message,
    code: errorCode,
    operation,
    error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    timestamp: new Date().toISOString()
  });
};

// ============================================================================
// SCHOOL MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Get School Management Data
 * GET /api/system-admin/schools/management
 * Provides comprehensive school management information
 */
const getSchoolManagement = catchAsync(async (req, res) => {
  try {
    const { page = 1, limit = 20, status, tier } = req.query;

    // Log the operation
    await logSystemAdminActivity(req.user.email, 'school_management_accessed', {
      endpoint: req.path,
      method: req.method,
      filters: { status, tier },
      pagination: { page, limit },
      severity: 'low'
    });

    // Get school management data
    const schoolData = await SystemAdminService.getSchoolManagement({
      page: parseInt(page),
      limit: parseInt(limit),
      status,
      tier
    });

    res.status(200).json({
      success: true,
      message: 'School management data retrieved successfully',
      data: schoolData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: schoolData.total,
        pages: Math.ceil(schoolData.total / parseInt(limit))
      }
    });

  } catch (error) {
    await handleCrossSchoolError(error, req, res, 'school_management');
  }
});

/**
 * Create New School
 * POST /api/system-admin/schools
 * Creates a new school in the platform
 */
const createSchool = catchAsync(async (req, res) => {
  try {
    const schoolData = req.body;

    // Log the operation
    await logSystemAdminActivity(req.user.email, 'school_creation_started', {
      endpoint: req.path,
      method: req.method,
      schoolName: schoolData.schoolName,
      email: schoolData.email,
      severity: 'high'
    });

    // Create school
    const newSchool = await SystemAdminService.createSchool(schoolData, req.user.email, contextFromRequest(req));

    // Log successful creation
    await logSystemAdminActivity(req.user.email, 'school_creation_completed', {
      schoolId: newSchool.school.schoolId,
      schoolName: newSchool.school.schoolName,
      severity: 'high'
    });

    res.status(201).json({
      success: true,
      message: 'School created successfully',
      data: newSchool
    });

  } catch (error) {
    await handleCrossSchoolError(error, req, res, 'school_creation');
  }
});

/**
 * Update School Configuration
 * PUT /api/system-admin/schools/:schoolId/config
 * Updates school configuration settings
 */
const updateSchoolConfig = catchAsync(async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: 'School ID parameter is missing',
        code: 'MISSING_SCHOOL_ID'
      });
    }
    
    const configUpdates = req.body;

    // Log the operation
    await logSystemAdminActivity(req.user.email, 'school_config_update_started', {
      endpoint: req.path,
      method: req.method,
      schoolId,
      configKeys: Object.keys(configUpdates),
      severity: 'high'
    });

    // Update school configuration
    const updatedSchool = await SystemAdminService.updateSchoolConfig(schoolId, configUpdates, req.user.email, contextFromRequest(req));

    // Log successful update
    await logSystemAdminActivity(req.user.email, 'school_config_update_completed', {
      schoolId,
      configKeys: Object.keys(configUpdates),
      severity: 'high'
    });

    res.status(200).json({
      success: true,
      message: 'School configuration updated successfully',
      data: updatedSchool
    });

  } catch (error) {
    logger.error('Update school config error:', error);
    logger.error('Error details:', {
      message: error.message,
      stack: error.stack,
      schoolId: req.params.schoolId,
      configUpdates: req.body
    });
    await handleCrossSchoolError(error, req, res, 'school_config_update');
  }
});

/**
 * Deactivate School
 * PUT /api/system-admin/schools/:schoolId/deactivate
 * Deactivates a school (soft delete)
 */
const deactivateSchool = catchAsync(async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { reason } = req.body;

    // Log the operation
    await logSystemAdminActivity(req.user.email, 'school_deactivation_started', {
      endpoint: req.path,
      method: req.method,
      schoolId,
      reason,
      severity: 'critical'
    });

    // Deactivate school
    const result = await SystemAdminService.deactivateSchool(schoolId, reason, req.user.email, contextFromRequest(req));

    // Log successful deactivation
    await logSystemAdminActivity(req.user.email, 'school_deactivation_completed', {
      schoolId,
      reason,
      affectedUsers: result.affectedUsers,
      severity: 'critical'
    });

    res.status(200).json({
      success: true,
      message: 'School deactivated successfully',
      data: result
    });

  } catch (error) {
    await handleCrossSchoolError(error, req, res, 'school_deactivation');
  }
});

/**
 * Reactivate School
 * PUT /api/system-admin/schools/:schoolId/reactivate
 * Reactivates a previously deactivated school
 */
const reactivateSchool = catchAsync(async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { reason } = req.body;

    // Log the operation
    await logSystemAdminActivity(req.user.email, 'school_reactivation_started', {
      endpoint: req.path,
      method: req.method,
      schoolId,
      reason,
      severity: 'high'
    });

    // Reactivate school
    const result = await SystemAdminService.reactivateSchool(schoolId, {
      reason,
      reactivatedBy: req.user.email,
      reactivatedAt: new Date(),
      context: contextFromRequest(req)
    });

    // Log successful reactivation
    await logSystemAdminActivity(req.user.email, 'school_reactivation_completed', {
      schoolId,
      reason,
      severity: 'high'
    });

    res.status(200).json({
      success: true,
      message: 'School reactivated successfully',
      data: result
    });

  } catch (error) {
    await handleCrossSchoolError(error, req, res, 'school_reactivation');
  }
});

// ============================================================================
// USER MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Get User Management Data
 * GET /api/system-admin/users/management
 * Provides cross-school user management information
 * Requirements: 3.1, 3.2
 */
const getUserManagement = catchAsync(async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      role, 
      status, 
      schoolId, 
      search 
    } = req.query;

    // Log the operation
    await logSystemAdminActivity(req.user.email, 'user_management_accessed', {
      endpoint: req.path,
      method: req.method,
      filters: { role, status, schoolId, search },
      pagination: { page, limit },
      severity: 'low'
    });

    // Get cross-school users data
    const userData = await SystemAdminService.getCrossSchoolUsers(
      { role, status, schoolId, search },
      { page: parseInt(page), limit: parseInt(limit) }
    );

    res.status(200).json({
      success: true,
      message: 'User management data retrieved successfully',
      data: userData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: userData.total,
        pages: Math.ceil(userData.total / parseInt(limit))
      }
    });

  } catch (error) {
    await handleCrossSchoolError(error, req, res, 'user_management');
  }
});

/**
 * Manage User Access
 * PUT /api/system-admin/users/:userId/access
 * Manages user access permissions across schools
 * Requirements: 3.2, 3.4
 */
const manageUserAccess = catchAsync(async (req, res) => {
  try {
    const { userId } = req.params;
    const permissions = req.body;

    // Log the operation
    await logSystemAdminActivity(req.user.email, 'user_access_management_started', {
      endpoint: req.path,
      method: req.method,
      userId,
      action: permissions.action,
      reason: permissions.reason,
      severity: 'high'
    });

    // Manage user access
    const result = await SystemAdminService.manageUserAccess(userId, permissions, req.user.email, contextFromRequest(req));

    // Log successful operation
    await logSystemAdminActivity(req.user.email, 'user_access_management_completed', {
      userId,
      action: permissions.action,
      result: result.success,
      severity: 'high'
    });

    res.status(200).json({
      success: true,
      message: 'User access managed successfully',
      data: result
    });

  } catch (error) {
    await handleCrossSchoolError(error, req, res, 'user_access_management');
  }
});

/**
 * Get Security Alerts
 * GET /api/system-admin/security/alerts
 * Retrieves security alerts and monitoring information
 * Requirements: 5.1
 */
const getSecurityAlerts = catchAsync(async (req, res) => {
  try {
    const { 
      severity, 
      alertType, 
      schoolId, 
      isResolved, 
      page = 1, 
      limit = 20 
    } = req.query;

    // Log the operation
    await logSystemAdminActivity(req.user.email, 'security_alerts_accessed', {
      endpoint: req.path,
      method: req.method,
      filters: { severity, alertType, schoolId, isResolved },
      pagination: { page, limit },
      severity: 'medium'
    });

    // Get security alerts
    const alertsData = await SystemAdminService.getSecurityAlerts({
      severity,
      alertType,
      schoolId,
      isResolved: isResolved === 'true' ? true : isResolved === 'false' ? false : undefined,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.status(200).json({
      success: true,
      message: 'Security alerts retrieved successfully',
      data: alertsData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: alertsData.total,
        pages: Math.ceil(alertsData.total / parseInt(limit))
      }
    });

  } catch (error) {
    await handleCrossSchoolError(error, req, res, 'security_alerts');
  }
});

module.exports = {
  getPlatformOverview,
  getSystemHealth,
  getPlatformKPIs,
  getCrossSchoolMetrics,
  // School management endpoints
  getSchoolManagement,
  createSchool,
  updateSchoolConfig,
  deactivateSchool,
  reactivateSchool,
  // User management endpoints
  getUserManagement,
  manageUserAccess,
  getSecurityAlerts,
  // Helper functions
  handleCrossSchoolError,
  determineOverallHealthStatus,
  parseTimeRange
};