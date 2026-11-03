/**
 * System Admin Service
 * Provides platform overview, school management, and cross-school user management
 * Centralizes business logic for system admin operations
 * Requirements: 1.1, 2.1, 3.1
 */

const { prisma } = require('../config/database');
const CrossSchoolAggregator = require('./crossSchoolAggregator');
const CacheService = require('./cacheService');
const logger = require('../utils/logger');
const administration = require('./schoolAdministrationService');
const audit = require('./platformAuditService');

class SystemAdminService {
  /**
   * Get comprehensive platform overview and metrics
   * @param {Object} options - Query options
   * @returns {Object} Platform overview data
   */
  static async getPlatformOverview(options = {}) {
    const cacheKey = `overview:${JSON.stringify(options)}`;
    const cachedData = await CacheService.getPlatformCache(cacheKey);
    
    if (cachedData) {
      logger.info('📊 Platform overview cache HIT');
      return { ...cachedData, cached: true };
    }

    logger.info('📊 Platform overview cache MISS - generating fresh data');

    try {
      // Get platform KPIs
      const platformKPIs = await CrossSchoolAggregator.calculatePlatformKPIs();
      
      // Get recent activity
      const recentActivity = await this._getRecentPlatformActivity();
      
      // Get system health
      const systemHealth = await this._getSystemHealth();
      
      // Get critical alerts
      const criticalAlerts = await this._getCriticalAlerts();
      
      // Get subscription overview
      const subscriptionOverview = await this._getSubscriptionOverview();

      const overview = {
        kpis: platformKPIs,
        recentActivity,
        systemHealth,
        criticalAlerts,
        subscriptionOverview,
        generatedAt: new Date().toISOString(),
        cached: false
      };

      // Cache for 5 minutes (platform overview needs to be fresh)
      await CacheService.setPlatformCache(cacheKey, overview, 300);
      logger.info('📊 Platform overview cached');

      return overview;

    } catch (error) {
      logger.error('Error generating platform overview:', error);
      throw new Error(`Failed to generate platform overview: ${error.message}`);
    }
  }

  /**
   * Get platform metrics with filtering and time range
   * @param {Object} filters - Metric filters
   * @param {Object} timeRange - Time range for metrics
   * @returns {Object} Platform metrics data
   */
  static async getPlatformMetrics(filters = {}, timeRange = {}) {
    const { metric = 'overview', schoolIds = null } = filters;
    
    try {
      return await CrossSchoolAggregator.aggregateMetrics(schoolIds, metric, timeRange);
    } catch (error) {
      logger.error('Error getting platform metrics:', error);
      throw new Error(`Failed to get platform metrics: ${error.message}`);
    }
  }

  /**
   * Get school comparison analytics
   * @param {Array<string>} schoolIds - School IDs to compare
   * @param {Array<string>} criteria - Comparison criteria
   * @param {Object} timeRange - Time range for comparison
   * @returns {Object} School comparison data
   */
  static async getSchoolComparisons(schoolIds, criteria, timeRange = {}) {
    try {
      return await CrossSchoolAggregator.compareSchoolPerformance(schoolIds, criteria, timeRange);
    } catch (error) {
      logger.error('Error getting school comparisons:', error);
      throw new Error(`Failed to get school comparisons: ${error.message}`);
    }
  }

  /**
   * Get system health status and metrics
   * @returns {Object} System health data
   */
  static async getSystemHealth() {
    const cacheKey = 'system-health';
    const cachedData = await CacheService.getPlatformCache(cacheKey);
    
    if (cachedData) {
      logger.info('🏥 System health cache HIT');
      return { ...cachedData, cached: true };
    }

    logger.info('🏥 System health cache MISS - checking system health');

    try {
      const systemHealth = await this._getSystemHealth();
      
      // Cache for 2 minutes (system health should be very fresh)
      await CacheService.setPlatformCache(cacheKey, systemHealth, 120);
      logger.info('🏥 System health cached');

      return { ...systemHealth, cached: false };

    } catch (error) {
      logger.error('Error getting system health:', error);
      throw new Error(`Failed to get system health: ${error.message}`);
    }
  }

  // ========================================
  // SCHOOL MANAGEMENT METHODS
  // Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
  // ========================================

  /**
   * Get school management data with filtering and pagination
   * @param {Object} options - Options including filters and pagination
   * @returns {Object} School management data
   */
  static async getSchoolManagement(options = {}) {
    const { page = 1, limit = 20, status, tier, search } = options;
    
    // Build filters
    const filters = {};
    // Archived ("removed") schools stay out of the normal list unless asked for.
    if (status === 'all') {
      filters.archived = 'include';
    } else if (status === 'archived') {
      filters.archived = 'only';
    } else if (status === 'deleted') {
      filters.deleted = 'only';
    } else if (status) {
      filters.isActive = status === 'active';
    }
    if (tier && tier !== 'all') {
      filters.subscriptionTier = tier;
    }
    if (search) {
      filters.search = search;
    }

    // Build pagination
    const pagination = { page, limit, sortBy: 'createdAt', sortOrder: 'desc' };

    // Use getAllSchools method
    return await this.getAllSchools(filters, pagination);
  }

  /**
   * Get all schools with filtering and pagination
   * @param {Object} filters - School filters
   * @param {Object} pagination - Pagination options
   * @returns {Object} Schools data with pagination
   */
  static async getAllSchools(filters = {}, pagination = {}) {
    const {
      isActive,
      subscriptionTier,
      subscriptionStatus,
      search,
      hasFlags,
      archived = 'exclude',
      deleted = 'exclude'
    } = filters;

    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = pagination;

    try {
      // Build where clause
      const where = {};
      
      if (isActive !== undefined) where.isActive = isActive;
      if (archived === 'exclude') where.archivedAt = null;
      if (archived === 'only') where.archivedAt = { not: null };
      // Deleted schools are hidden unless asked for (status=deleted or status=all).
      if (deleted === 'exclude' && archived !== 'include') where.isDeleted = false;
      if (deleted === 'only') where.isDeleted = true;
      if (subscriptionTier) where.systemConfig = { path: ['subscriptionTier'], equals: subscriptionTier };
      if (hasFlags) where.systemMetadata = { path: ['flags'], array_contains: [{ isActive: true }] };
      
      if (search) {
        where.OR = [
          { schoolName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { schoolId: { contains: search, mode: 'insensitive' } }
        ];
      }

      // Map sortBy to Prisma field
      const orderBy = {};
      if (sortBy === 'createdAt') {
        orderBy.createdAt = sortOrder === 'desc' ? 'desc' : 'asc';
      }

      // Execute query with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [schools, total] = await Promise.all([
        prisma.school.findMany({
          where,
          orderBy,
          skip,
          take: parseInt(limit)
        }),
        prisma.school.count({ where })
      ]);

      // Enhance school data with statistics
      const enhancedSchools = await Promise.all(
        schools.map(async (school) => {
          const [userCount, studentCount, activeFlags] = await Promise.all([
            prisma.user.count({ where: { schoolId: school.id } }),
            prisma.student.count({ where: { schoolId: school.id, isActive: true } }),
            Promise.resolve(school.systemMetadata?.flags?.filter(flag => flag.isActive).length || 0)
          ]);

          // Credentials never leave the server, even to a system admin.
          const { password, passwordResetToken, passwordResetExpires, verificationOTP, otpExpires, ...safeSchool } = school;

          return {
            ...safeSchool,
            status: school.isDeleted ? 'deleted' : school.archivedAt ? 'archived' : (school.isActive ? 'active' : 'inactive'),
            statistics: {
              totalUsers: userCount,
              totalStudents: studentCount,
              activeFlags
            }
          };
        })
      );

      return {
        schools: enhancedSchools,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        },
        filters
      };

    } catch (error) {
      logger.error('Error getting all schools:', error);
      throw new Error(`Failed to get schools: ${error.message}`);
    }
  }

  /**
   * Create a new school instance
   * @param {Object} schoolData - School creation data
   * @param {string} systemAdminId - System admin ID for tracking
   * @returns {Object} Created school data
   */
  static async createSchool(schoolData, systemAdminId, context = {}) {
    return administration.createSchool(schoolData, systemAdminId, context);
  }

  /**
   * Update school configuration
   * @param {string} schoolId - School ID to update
   * @param {Object} configData - Configuration data to update
   * @param {string} systemAdminId - System admin ID for tracking
   * @returns {Object} Updated school data
   */
  static async updateSchoolConfig(schoolId, configData, systemAdminId, context = {}) {
    try {
      const school = await prisma.school.findFirst({
        where: { schoolId }
      });
      
      if (!school) {
        throw new Error('School not found');
      }

      const {
        subscriptionTier,
        subscriptionStatus,
        features,
        limits,
        billing,
        systemNote
      } = configData;

      // Track changes for audit log
      const changes = { before: {}, after: {} };

      // Build update data
      const updateData = {};
      const systemConfig = { ...(school.systemConfig || {}) };
      const systemMetadata = { ...(school.systemMetadata || {}) };

      // Update subscription tier
      if (subscriptionTier && subscriptionTier !== systemConfig.subscriptionTier) {
        changes.before.subscriptionTier = systemConfig.subscriptionTier;
        changes.after.subscriptionTier = subscriptionTier;
        systemConfig.subscriptionTier = subscriptionTier;
      }

      // Update subscription status
      if (subscriptionStatus && subscriptionStatus !== systemConfig.subscriptionStatus) {
        changes.before.subscriptionStatus = systemConfig.subscriptionStatus;
        changes.after.subscriptionStatus = subscriptionStatus;
        systemConfig.subscriptionStatus = subscriptionStatus;
      }

      // Update features
      if (features && Array.isArray(features)) {
        if (!systemConfig.features) systemConfig.features = [];
        features.forEach(feature => {
          const existingFeature = systemConfig.features.find(f => f.featureName === feature.featureName);
          if (existingFeature) {
            existingFeature.isEnabled = feature.isEnabled;
            if (feature.expiresAt) existingFeature.expiresAt = feature.expiresAt;
          } else {
            systemConfig.features.push(feature);
          }
        });
        changes.after.features = features;
      }

      // Update limits
      if (limits) {
        changes.before.limits = { ...systemConfig.limits };
        changes.after.limits = limits;
        systemConfig.limits = { ...(systemConfig.limits || {}), ...limits };
      }

      // Update billing information
      if (billing) {
        changes.before.billing = { ...systemConfig.billing };
        changes.after.billing = billing;
        systemConfig.billing = { ...(systemConfig.billing || {}), ...billing };
      }

      updateData.systemConfig = systemConfig;

      // Add system note if provided
      if (systemNote) {
        if (!systemMetadata.systemNotes) systemMetadata.systemNotes = [];
        systemMetadata.systemNotes.push({
          note: systemNote,
          createdBy: systemAdminId,
          category: 'technical',
          createdAt: new Date()
        });
        updateData.systemMetadata = systemMetadata;
      }

      // Update the school
      await prisma.school.update({
        where: { id: school.id },
        data: updateData
      });

      // Log the update
      await audit.record({
        action: 'school.config_update',
        entityType: 'school',
        entityId: school.schoolId,
        schoolId: school.id,
        actor: systemAdminId,
        context,
        details: { schoolCode: school.schoolId, changes }
      });

      // Invalidate caches
      await CacheService.invalidatePlatformCachesForSchool(schoolId);

      // Return updated school
      const updatedSchool = await prisma.school.findFirst({
        where: { schoolId }
      });
      return {
        school: {
          id: updatedSchool.id,
          schoolId: updatedSchool.schoolId,
          schoolName: updatedSchool.schoolName,
          isActive: updatedSchool.isActive,
          subscriptionTier: updatedSchool.systemConfig?.subscriptionTier,
          subscriptionStatus: updatedSchool.systemConfig?.subscriptionStatus
        }
      };

    } catch (error) {
      logger.error('Error updating school config:', error);
      throw new Error(`Failed to update school configuration: ${error.message}`);
    }
  }

  /**
   * Deactivate a school
   * @param {string} schoolId - School ID to deactivate
   * @param {string} reason - Reason for deactivation
   * @param {string} systemAdminId - System admin ID for tracking
   * @returns {Object} Deactivation result
   */
  static async deactivateSchool(schoolId, reason, systemAdminId, context = {}) {
    return administration.deactivateSchool(schoolId, reason, systemAdminId, context);
  }

  /**
   * Reactivate a school
   * @param {string} schoolId - School ID to reactivate
   * @param {Object} options - Reactivation options
   * @returns {Object} Reactivation result
   */
  static async reactivateSchool(schoolId, options = {}) {
    return administration.reactivateSchool(schoolId, options);
  }

  // ========================================
  // CROSS-SCHOOL USER MANAGEMENT METHODS
  // Requirements: 3.1, 3.2, 3.3
  // ========================================

  /**
   * Get cross-school users with filtering and pagination
   * @param {Object} filters - User filters
   * @param {Object} pagination - Pagination options
   * @returns {Object} Cross-school users data
   */
  static async getCrossSchoolUsers(filters = {}, pagination = {}) {
    const {
      role,
      isActive,
      isVerified,
      schoolIds,
      search,
      hasFlags
    } = filters;

    const {
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = pagination;

    try {
      // Build where clause
      const where = { isDeleted: false };

      if (role && role !== 'all') where.role = role;
      if (isActive !== undefined) where.isActive = isActive;
      if (isVerified !== undefined) where.isVerified = isVerified;
      if (schoolIds && schoolIds.length > 0) {
        const schools = await prisma.school.findMany({
          where: { schoolId: { in: schoolIds } }
        });
        where.schoolId = { in: schools.map(s => s.id) };
      }
      
      if (search) {
        where.OR = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } }
        ];
      }

      // Execute query with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const orderBy = {};
      if (sortBy === 'createdAt') {
        orderBy.createdAt = sortOrder === 'desc' ? 'desc' : 'asc';
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          include: {
            school: {
              select: {
                schoolId: true,
                schoolName: true
              }
            }
          },
          orderBy,
          skip,
          take: parseInt(limit)
        }),
        prisma.user.count({ where })
      ]);

      // Enhance user data
      const enhancedUsers = users.map(user => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`,
        email: user.email,
        role: user.role,
        subjects: user.subjects,
        classes: user.classes,
        isActive: user.isActive,
        isVerified: user.isVerified,
        school: user.school ? {
          schoolId: user.school.schoolId,
          schoolName: user.school.schoolName
        } : null,
        statusDisplay: this._getUserStatusDisplay(user)
      }));

      return {
        users: enhancedUsers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        },
        filters,
        summary: {
          totalUsers: total,
          byRole: await this._getUserSummaryByRole(where),
          byStatus: await this._getUserSummaryByStatus(where)
        }
      };

    } catch (error) {
      logger.error('Error getting cross-school users:', error);
      throw new Error(`Failed to get cross-school users: ${error.message}`);
    }
  }

  /**
   * Manage user access across schools
   * @param {string} userId - User ID to manage
   * @param {Object} permissions - Permission changes
   * @param {string} systemAdminId - System admin ID for tracking
   * @returns {Object} Updated user data
   */
  static async manageUserAccess(userId, permissions, systemAdminId, context = {}) {
    return administration.manageUserAccess(userId, permissions, systemAdminId, context);
  }

  /**
   * Get security alerts across all schools
   * @param {Object} filters - Alert filters
   * @returns {Object} Security alerts data
   */
  static async getSecurityAlerts(filters = {}) {
    const {
      severity,
      alertType,
      isResolved = false,
      schoolIds,
      timeRange
    } = filters;

    try {
      const where = { isRead: isResolved };
      
      if (severity) where.type = severity;
      if (alertType) where.alertType = alertType;
      if (schoolIds && schoolIds.length > 0) where.schoolId = { in: schoolIds };
      
      if (timeRange && (timeRange.startDate || timeRange.endDate)) {
        where.createdAt = {};
        if (timeRange.startDate) where.createdAt.gte = new Date(timeRange.startDate);
        if (timeRange.endDate) where.createdAt.lte = new Date(timeRange.endDate);
      }

      const alerts = await prisma.systemAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100 // Limit to prevent performance issues
      });

      const alertSummary = {
        total: alerts.length,
        bySeverity: this._groupAlertsBySeverity(alerts),
        byType: this._groupAlertsByType(alerts),
        bySchool: this._groupAlertsBySchool(alerts)
      };

      return {
        alerts: alerts.map(alert => ({
          id: alert.id,
          title: alert.title,
          description: alert.message,
          alertType: alert.type,
          severity: alert.type,
          schoolId: alert.schoolId,
          createdAt: alert.createdAt,
          ageInMinutes: Math.floor((Date.now() - alert.createdAt.getTime()) / (1000 * 60))
        })),
        summary: alertSummary,
        filters
      };

    } catch (error) {
      logger.error('Error getting security alerts:', error);
      throw new Error(`Failed to get security alerts: ${error.message}`);
    }
  }

  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  /**
   * Get recent platform activity
   * @private
   */
  static async _getRecentPlatformActivity() {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const recentLogs = await prisma.platformAuditLog.findMany({
      where: {
        createdAt: { gte: twentyFourHoursAgo }
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        school: {
          select: {
            schoolName: true,
            schoolId: true
          }
        }
      }
    });

    return {
      totalOperations: recentLogs.length,
      recentOperations: recentLogs.map(log => ({
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        actor: log.userId || 'System',
        school: log.school?.schoolName || (log.details && log.details.schoolName) || 'Platform',
        createdAt: log.createdAt
      }))
    };
  }

  /**
   * Get system health metrics
   * @private
   */
  static async _getSystemHealth() {
    const [
      criticalAlerts,
      errorAlerts,
      cacheStats,
      recentErrors
    ] = await Promise.all([
      prisma.systemAlert.count({ where: { type: 'critical', isRead: false } }),
      prisma.systemAlert.count({ where: { type: 'error', isRead: false } }),
      CacheService.getCachePerformanceMetrics(),
      prisma.platformAuditLog.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } // Last hour
        }
      })
    ]);

    let healthStatus = 'healthy';
    if (criticalAlerts > 0) healthStatus = 'critical';
    else if (errorAlerts > 5 || recentErrors > 10) healthStatus = 'warning';

    return {
      status: healthStatus,
      criticalAlerts,
      errorAlerts,
      recentErrors,
      cache: {
        available: cacheStats.available,
        hitRate: cacheStats.stats?.hitRate || 0
      },
      lastChecked: new Date().toISOString()
    };
  }

  /**
   * Get critical alerts
   * @private
   */
  static async _getCriticalAlerts() {
    const criticalAlerts = await prisma.systemAlert.findMany({
      where: {
        type: 'critical',
        isRead: false
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    return criticalAlerts.map(alert => ({
      id: alert.id,
      title: alert.title,
      description: alert.message,
      alertType: alert.type,
      schoolId: alert.schoolId,
      createdAt: alert.createdAt,
      ageInMinutes: Math.floor((Date.now() - alert.createdAt.getTime()) / (1000 * 60))
    }));
  }

  /**
   * Get subscription overview
   * @private
   */
  static async _getSubscriptionOverview() {
    const schools = await prisma.school.findMany({
      where: { isActive: true },
      select: {
        systemConfig: true
      }
    });

    const byTier = {};
    const byStatus = {};

    schools.forEach(school => {
      const tier = school.systemConfig?.subscriptionTier || 'basic';
      const status = school.systemConfig?.subscriptionStatus || 'trial';
      const revenue = school.systemConfig?.billing?.monthlyRevenue || 0;

      if (!byTier[tier]) {
        byTier[tier] = { count: 0, revenue: 0 };
      }
      byTier[tier].count++;
      byTier[tier].revenue += revenue;

      if (!byStatus[status]) {
        byStatus[status] = 0;
      }
      byStatus[status]++;
    });

    return { byTier, byStatus };
  }

  /**
   * Get user status display text
   * @private
   */
  static _getUserStatusDisplay(user) {
    if (!user.isActive) return 'Inactive';
    if (user.isTemporaryPassword) return 'Pending Registration';
    if (!user.isVerified) return 'Unverified';
    return 'Active';
  }

  /**
   * Get user summary by role
   * @private
   */
  static async _getUserSummaryByRole(baseWhere) {
    const users = await prisma.user.groupBy({
      by: ['role'],
      where: baseWhere,
      _count: {
        role: true
      }
    });

    return users.reduce((acc, stat) => {
      acc[stat.role] = stat._count.role;
      return acc;
    }, {});
  }

  /**
   * Get user summary by status
   * @private
   */
  static async _getUserSummaryByStatus(baseWhere) {
    const users = await prisma.user.findMany({
      where: baseWhere,
      select: {
        isActive: true,
        isVerified: true,
        isTemporaryPassword: true
      }
    });

    const summary = {
      active: 0,
      inactive: 0,
      verified: 0,
      unverified: 0,
      pendingRegistration: 0
    };

    users.forEach(user => {
      if (user.isActive) summary.active += 1;
      else summary.inactive += 1;
      
      if (user.isVerified) summary.verified += 1;
      else summary.unverified += 1;
      
      if (user.isTemporaryPassword) summary.pendingRegistration += 1;
    });

    return summary;
  }

  /**
   * Group alerts by severity
   * @private
   */
  static _groupAlertsBySeverity(alerts) {
    return alerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Group alerts by type
   * @private
   */
  static _groupAlertsByType(alerts) {
    return alerts.reduce((acc, alert) => {
      acc[alert.alertType] = (acc[alert.alertType] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Group alerts by school
   * @private
   */
  static _groupAlertsBySchool(alerts) {
    const schoolCounts = {};
    
    alerts.forEach(alert => {
      if (alert.affectedSchools && alert.affectedSchools.length > 0) {
        alert.affectedSchools.forEach(school => {
          const schoolName = school.schoolName || school;
          schoolCounts[schoolName] = (schoolCounts[schoolName] || 0) + 1;
        });
      }
    });
    
    return schoolCounts;
  }
}

module.exports = SystemAdminService;
