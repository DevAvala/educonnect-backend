/**
 * System Admin Authentication Controller
 * Handles authentication endpoints for system administrators
 * No registration or user management - only pre-configured authentication
 */

const { 
  loginSystemAdmin, 
  refreshSystemAdminToken, 
  verifySystemAdminToken,
  isSystemAdminConfigured 
} = require('../services/systemAdminAuthService');
const catchAsync = require('../utils/catchAsync');
const { 
  setRefreshTokenCookie, 
  clearRefreshTokenCookie, 
  getRefreshTokenFromCookie 
} = require('../utils/cookieHelper');
const logger = require('../utils/logger');

/**
 * System Admin Login
 * POST /api/system-admin/auth/login
 * Authenticates system admin using pre-configured credentials
 */
const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required',
      code: 'MISSING_CREDENTIALS'
    });
  }

  // Check if system admin is configured
  if (!isSystemAdminConfigured()) {
    return res.status(503).json({
      success: false,
      message: 'System admin not configured',
      code: 'SYSTEM_ADMIN_NOT_CONFIGURED'
    });
  }

  try {
    // Attempt login
    const result = await loginSystemAdmin(email, password);

    // Set refresh token as HttpOnly cookie (if available)
    if (result.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, req);
    }

    // Log successful login
    logger.info(`🔐 System admin login successful: ${email} at ${new Date().toISOString()}`);

    res.status(200).json({
      success: true,
      message: 'System admin login successful',
      data: {
        token: result.token,
        user: result.user,
        expiresIn: '8h' // Default session timeout
      }
    });

  } catch (error) {
    // Log failed login attempt
    logger.warn(`🚫 System admin login failed: ${email} - ${error.message}`);

    res.status(401).json({
      success: false,
      message: 'Invalid system admin credentials',
      code: 'INVALID_CREDENTIALS'
    });
  }
});

/**
 * Verify System Admin Token
 * GET /api/system-admin/auth/verify
 * Verifies if the current token is valid
 */
const verify = catchAsync(async (req, res) => {
  // Token verification is handled by middleware
  // If we reach here, token is valid
  
  res.status(200).json({
    success: true,
    message: 'Token is valid',
    data: {
      user: req.user,
      systemAdmin: req.systemAdmin,
      valid: true
    }
  });
});

/**
 * Refresh System Admin Token
 * POST /api/system-admin/auth/refresh
 * Refreshes the current system admin token using HttpOnly cookie or Authorization header
 */
const refresh = catchAsync(async (req, res) => {
  // Try to get refresh token from cookie first, then fallback to Authorization header
  let currentToken = getRefreshTokenFromCookie(req);
  let source = 'cookie';
  
  if (!currentToken) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      currentToken = authHeader.substring(7);
      source = 'header';
      logger.info('⚠️ Using token from Authorization header for system admin refresh (deprecated)');
    }
  }

  if (!currentToken) {
    return res.status(401).json({
      success: false,
      message: 'Token required for refresh',
      code: 'MISSING_TOKEN'
    });
  }

  try {
    const result = await refreshSystemAdminToken(currentToken);

    // Set new refresh token as HttpOnly cookie (if available)
    if (result.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, req);
    }

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        token: result.token,
        user: result.user,
        expiresIn: '8h'
      }
    });

  } catch (error) {
    // Clear invalid refresh token cookie
    clearRefreshTokenCookie(res, req);
    
    res.status(401).json({
      success: false,
      message: 'Token refresh failed',
      code: 'REFRESH_FAILED',
      error: error.message
    });
  }
});

/**
 * System Admin Logout
 * POST /api/system-admin/auth/logout
 * Logs out system admin and clears HttpOnly cookie
 */
const logout = catchAsync(async (req, res) => {
  try {
    // Clear refresh token cookie
    clearRefreshTokenCookie(res, req);

    // Log the logout for audit purposes
    if (req.user && req.user.role === 'system_admin') {
      logger.info(`🔓 System admin logout: ${req.user.email} at ${new Date().toISOString()}`);
    }

    res.status(200).json({
      success: true,
      message: 'Logout successful',
      data: {
        loggedOut: true,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    // Even if there's an error, clear the cookie
    clearRefreshTokenCookie(res, req);
    
    res.status(200).json({
      success: true,
      message: 'Logout successful',
      data: {
        loggedOut: true,
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * Get System Admin Status
 * GET /api/system-admin/auth/status
 * Returns system admin configuration status (for setup verification)
 */
const getStatus = catchAsync(async (req, res) => {
  const configured = isSystemAdminConfigured();

  res.status(200).json({
    success: true,
    message: 'System admin status retrieved',
    data: {
      configured,
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    }
  });
});

/**
 * Get Current System Admin Profile
 * Returns system admin information based on refresh token from HttpOnly cookie
 * Requirements: Session management, System admin profile access
 */
const getMe = catchAsync(async (req, res) => {
  try {
    // Get refresh token from HttpOnly cookie
    const refreshToken = getRefreshTokenFromCookie(req);
    
    if (!refreshToken) {
      // Clear any existing cookies and return unauthorized
      clearRefreshTokenCookie(res, req);
      return res.status(401).json({
        success: false,
        message: 'No active session found'
      });
    }

    // Verify refresh token using system admin auth service
    const { verifySystemAdminRefreshToken } = require('../services/systemAdminAuthService');
    let decoded;
    
    try {
      decoded = verifySystemAdminRefreshToken(refreshToken);
    } catch (error) {
      // Token is invalid or expired, clear cookies
      clearRefreshTokenCookie(res, req);
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please log in again.'
      });
    }

    // Return system admin profile data
    res.status(200).json({
      success: true,
      user: {
        id: `system_admin_${decoded.email}`,
        email: decoded.email,
        firstName: 'System',
        lastName: 'Administrator',
        fullName: 'System Administrator',
        role: 'system_admin',
        schoolId: null,
        school: null,
        isActive: true,
        isVerified: true,
        isSystemAdmin: true,
        systemAdminLevel: decoded.systemAdminLevel,
        crossSchoolAccess: decoded.crossSchoolAccess,
        loginTime: new Date(decoded.iat * 1000),
        expiresAt: new Date(decoded.exp * 1000)
      }
    });

  } catch (error) {
    logger.error('Error in getMe (system admin):', error);
    
    // Clear cookies on any error
    clearRefreshTokenCookie(res, req);
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = {
  login,
  verify,
  refresh,
  logout,
  getStatus,
  getMe
};