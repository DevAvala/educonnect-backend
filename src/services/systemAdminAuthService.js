/**
 * System Admin Authentication Service
 * Handles pre-configured authentication for system administrators
 * No database storage - uses environment variables for credentials
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Validate system admin credentials against environment variables
 * @param {string} email - System admin email
 * @param {string} password - System admin password
 * @returns {Promise<boolean>} - True if credentials are valid
 */
const validateSystemAdminCredentials = async (email, password) => {
  try {
    // Check if system admin credentials are configured
    if (!process.env.SYSTEM_ADMIN_EMAIL || !process.env.SYSTEM_ADMIN_PASSWORD_HASH) {
      logger.error('System admin credentials not configured in environment variables');
      return false;
    }

    // Validate email
    if (email !== process.env.SYSTEM_ADMIN_EMAIL) {
      return false;
    }

    // Validate password
    const isPasswordValid = await bcrypt.compare(password, process.env.SYSTEM_ADMIN_PASSWORD_HASH);
    return isPasswordValid;

  } catch (error) {
    logger.error('Error validating system admin credentials:', error);
    return false;
  }
};

/**
 * Generate JWT token for system admin
 * @param {string} email - System admin email
 * @returns {string} - JWT token
 */
const generateSystemAdminToken = (email) => {
  const payload = {
    email,
    role: 'system_admin',
    crossSchoolAccess: true,
    systemAdminLevel: 'super',
    type: 'system_admin'
  };

  const secret = process.env.SYSTEM_ADMIN_JWT_SECRET || process.env.JWT_SECRET;
  const expiresIn = process.env.SYSTEM_ADMIN_SESSION_TIMEOUT 
    ? `${process.env.SYSTEM_ADMIN_SESSION_TIMEOUT}s` 
    : '8h';

  return jwt.sign(payload, secret, { expiresIn });
};

/**
 * Verify system admin JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object|null} - Decoded token payload or null if invalid
 */
const verifySystemAdminToken = (token) => {
  try {
    const secret = process.env.SYSTEM_ADMIN_JWT_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);
    
    // Ensure this is a system admin token
    if (decoded.role !== 'system_admin' || decoded.type !== 'system_admin') {
      return null;
    }

    return decoded;
  } catch (error) {
    logger.error('Error verifying system admin token:', error.message);
    return null;
  }
};

/**
 * System admin login service
 * @param {string} email - System admin email
 * @param {string} password - System admin password
 * @returns {Promise<Object>} - Login result with token and user info
 */
const loginSystemAdmin = async (email, password) => {
  // Validate credentials
  const isValid = await validateSystemAdminCredentials(email, password);
  
  if (!isValid) {
    throw new Error('Invalid system admin credentials');
  }

  // Generate token
  const token = generateSystemAdminToken(email);

  // Return user info (no sensitive data)
  return {
    success: true,
    token,
    user: {
      email,
      role: 'system_admin',
      crossSchoolAccess: true,
      systemAdminLevel: 'super'
    }
  };
};

/**
 * Refresh system admin token
 * @param {string} currentToken - Current JWT token
 * @returns {Promise<Object>} - New token or error
 */
const refreshSystemAdminToken = async (currentToken) => {
  const decoded = verifySystemAdminToken(currentToken);
  
  if (!decoded) {
    throw new Error('Invalid or expired token');
  }

  // Generate new token
  const newToken = generateSystemAdminToken(decoded.email);

  return {
    success: true,
    token: newToken,
    user: {
      email: decoded.email,
      role: 'system_admin',
      crossSchoolAccess: true,
      systemAdminLevel: 'super'
    }
  };
};

/**
 * Check if system admin credentials are properly configured
 * @returns {boolean} - True if credentials are configured
 */
const isSystemAdminConfigured = () => {
  return !!(process.env.SYSTEM_ADMIN_EMAIL && process.env.SYSTEM_ADMIN_PASSWORD_HASH);
};

/**
 * Generate bcrypt hash for system admin password (utility function)
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Bcrypt hash
 */
const generatePasswordHash = async (password) => {
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
  return await bcrypt.hash(password, saltRounds);
};

module.exports = {
  validateSystemAdminCredentials,
  generateSystemAdminToken,
  verifySystemAdminToken,
  loginSystemAdmin,
  refreshSystemAdminToken,
  isSystemAdminConfigured,
  generatePasswordHash
};