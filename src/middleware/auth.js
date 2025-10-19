const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/config');
const UserService = require('../services/userService');
const logger = require('../utils/logger');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, config.jwtSecret);
    
    // Get fresh user data from database to ensure user is still active
    const user = await UserService.getUserById(decoded.id);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token. User not found.'
      });
    }

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated.'
      });
    }

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isAdmin: user.role === 'admin',
      isInstructor: ['admin', 'instructor'].includes(user.role),
      is_active: user.is_active,
      is_validated: user.is_validated
    };
    
    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token.'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired.'
      });
    }
    
    res.status(401).json({
      success: false,
      error: 'Authentication failed.'
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      // User provided a token, try to authenticate
      try {
        const decoded = jwt.verify(token, config.jwtSecret);
        
        // Get fresh user data from database
        const user = await UserService.getUserById(decoded.id);
        
        if (user && user.is_active) {
          req.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            isAdmin: user.role === 'admin',
            isInstructor: ['admin', 'instructor'].includes(user.role),
            is_active: user.is_active,
            is_validated: user.is_validated
          };
          logger.debug('User authenticated:', user.username);
        } else {
          logger.warn('Token valid but user not found or inactive');
          req.user = null;
        }
      } catch (error) {
        logger.warn('Invalid token provided, treating as anonymous:', error.message);
        req.user = null;
      }
    } else {
      // No token provided, anonymous user
      req.user = null;
    }

    // Handle session ID for anonymous users
    if (!req.user) {
      // Look for session ID in various places
      let sessionId = req.header('X-Session-ID') || 
                     req.cookies?.sessionId || 
                     req.session?.id;
      
      if (!sessionId) {
        // Generate new session ID
        sessionId = uuidv4();
        logger.debug('Generated new sessionId for anonymous user:', sessionId);
        
        // Set session cookie if possible
        if (res.cookie) {
          res.cookie('sessionId', sessionId, {
            httpOnly: true,
            secure: config.nodeEnv === 'production',
            sameSite: 'lax',
            maxAge: config.session.maxAge
          });
        }
        
        // Set response header
        res.setHeader('X-Session-Id', sessionId);
      } else {
        logger.debug('Using existing sessionId for anonymous user:', sessionId);
        // Ensure session ID is in response header
        res.setHeader('X-Session-Id', sessionId);
      }
      
      req.sessionId = sessionId;
    } else {
      // Authenticated user doesn't need session ID
      req.sessionId = null;
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    // In case of error, continue as anonymous
    req.user = null;
    req.sessionId = uuidv4();
    res.setHeader('X-Session-Id', req.sessionId);
    next();
  }
};

const adminAuth = async (req, res, next) => {
  // First authenticate the user
  await auth(req, res, () => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
    
    next();
  });
};

const instructorAuth = async (req, res, next) => {
  // First authenticate the user
  await auth(req, res, () => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }

    if (!['admin', 'instructor'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Instructor privileges required.'
      });
    }
    
    next();
  });
};

const validateAuth = async (req, res, next) => {
  // Similar to auth but also checks if user is validated
  await auth(req, res, () => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }

    if (config.security.requireEmailVerification && !req.user.is_validated) {
      return res.status(403).json({
        success: false,
        error: 'Email verification required.'
      });
    }
    
    next();
  });
};

// Rate limiting middleware for auth endpoints
const authRateLimit = (req, res, next) => {
  // This could be implemented with Redis or in-memory store
  // For now, just pass through
  // In production, you might want to implement this with express-rate-limit
  // and a Redis store for distributed applications
  next();
};

// Middleware to refresh token if it's close to expiring
const refreshTokenIfNeeded = async (req, res, next) => {
  if (req.user) {
    try {
      const token = req.header('Authorization')?.replace('Bearer ', '');
      if (token) {
        const decoded = jwt.decode(token);
        const now = Date.now() / 1000;
        const timeUntilExpiry = decoded.exp - now;
        
        // If token expires in less than 1 hour, provide a new one
        if (timeUntilExpiry < 3600) {
          const user = await UserService.getUserById(req.user.id);
          if (user) {
            const newToken = user.generateToken();
            res.setHeader('X-New-Token', newToken);
            logger.debug('New token generated for user:', user.username);
          }
        }
      }
    } catch (error) {
      logger.error('Error refreshing token:', error);
      // Don't fail the request, just log the error
    }
  }
  
  next();
};

// Middleware to check if user can access specific resource
const resourceAuth = (resourceIdParam = 'id', allowRoles = ['admin']) => {
  return async (req, res, next) => {
    await auth(req, res, () => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required.'
        });
      }

      const resourceId = req.params[resourceIdParam];
      
      // Admin or specified roles can access any resource
      if (allowRoles.includes(req.user.role)) {
        return next();
      }
      
      // Users can only access their own resources
      if (parseInt(resourceId) === req.user.id) {
        return next();
      }
      
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only access your own resources.'
      });
    });
  };
};

module.exports = {
  auth,
  optionalAuth,
  adminAuth,
  instructorAuth,
  validateAuth,
  authRateLimit,
  refreshTokenIfNeeded,
  resourceAuth
};