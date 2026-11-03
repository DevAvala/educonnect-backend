/**
 * System Admin Authentication Validation Middleware
 * Input validation for system admin authentication endpoints
 */

const { body, validationResult } = require('express-validator');

/**
 * Handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: errors.array().map(error => ({
        field: error.path,
        message: error.msg,
        value: error.value
      }))
    });
  }
  
  next();
};

/**
 * Validate system admin login request
 */
const validateLogin = [
  body('email')
    .isEmail()
    .withMessage('Valid email address is required')
    .normalizeEmail()
    .trim(),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  
  handleValidationErrors
];

/**
 * Validate token refresh request
 * (Token validation is handled by middleware, this is for additional validation)
 */
const validateRefresh = [
  // No body validation needed for refresh - token comes from header
  handleValidationErrors
];

/**
 * Sanitize and validate system admin requests
 * General middleware for all system admin endpoints
 */
const sanitizeSystemAdminRequest = (req, res, next) => {
  // Remove any potentially dangerous fields from request body
  const dangerousFields = [
    'role', 'permissions', 'isActive', 'schoolId', 
    'systemAdminLevel', 'crossSchoolAccess', '__proto__', 
    'constructor', 'prototype'
  ];
  
  dangerousFields.forEach(field => {
    if (req.body && req.body[field] !== undefined) {
      delete req.body[field];
    }
  });
  
  // Ensure request doesn't contain SQL injection attempts
  const sqlInjectionPattern = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i;
  
  const checkForSQLInjection = (obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'string' && sqlInjectionPattern.test(obj[key])) {
        return true;
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (checkForSQLInjection(obj[key])) {
          return true;
        }
      }
    }
    return false;
  };
  
  if (checkForSQLInjection(req.body) || checkForSQLInjection(req.query)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request content detected',
      code: 'INVALID_REQUEST_CONTENT'
    });
  }
  
  next();
};

/**
 * Rate limiting validation for system admin operations
 */
const validateSystemAdminRateLimit = (req, res, next) => {
  // Add additional headers for system admin operations
  res.set({
    'X-System-Admin-Operation': 'true',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block'
  });
  
  next();
};

/**
 * Validate system admin session requirements
 */
const validateSystemAdminSession = (req, res, next) => {
  // Check for required headers
  const requiredHeaders = ['user-agent'];
  const missingHeaders = requiredHeaders.filter(header => !req.get(header));
  
  if (missingHeaders.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Required headers missing',
      code: 'MISSING_HEADERS',
      missingHeaders
    });
  }
  
  // Validate user agent (basic check for automated requests)
  const userAgent = req.get('User-Agent');
  if (!userAgent || userAgent.length < 10) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user agent',
      code: 'INVALID_USER_AGENT'
    });
  }
  
  next();
};

/**
 * Comprehensive validation chain for system admin authentication
 */
const createSystemAdminValidationChain = (...validators) => {
  return [
    sanitizeSystemAdminRequest,
    validateSystemAdminRateLimit,
    validateSystemAdminSession,
    ...validators
  ];
};

module.exports = {
  validateLogin,
  validateRefresh,
  sanitizeSystemAdminRequest,
  validateSystemAdminRateLimit,
  validateSystemAdminSession,
  createSystemAdminValidationChain,
  handleValidationErrors
};