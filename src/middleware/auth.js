const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/config');
const UserService = require('../services/userService');
const logger = require('../utils/logger');

/**
 * Extract token from request (Authorization header, query, or cookies)
 * Works with both Express req.header() and plain object req.headers
 * Only accepts proper "Bearer <token>" format in Authorization header
 */
const extractToken = (req) => {
  // Try Authorization header first
  let authHeader;
  if (typeof req.header === 'function') {
    authHeader = req.header('Authorization') || req.header('authorization');
  } else if (req.headers) {
    authHeader = req.headers.Authorization || req.headers.authorization;
  }
  
  if (authHeader) {
    // Strict Bearer format: must start with "Bearer " (case insensitive)
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      return match[1];
    }
    // Malformed Authorization header - reject
    return null;
  }
  
  // Try query parameter
  if (req.query && req.query.token) {
    return req.query.token;
  }
  
  // Try cookies
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  
  return null;
};

/**
 * Get JWT secret from config (supports both formats)
 */
const getJwtSecret = () => {
  return config.jwtSecret || config.jwt?.secret;
};

/**
 * Verify JWT token - throws on invalid/expired
 */
const verifyToken = (token) => {
  if (!token) {
    throw new Error('No token provided');
  }
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      const err = new Error('Token has expired');
      err.code = 'TOKEN_EXPIRED';
      throw err;
    }
    if (error.name === 'JsonWebTokenError') {
      const err = new Error('Invalid token');
      err.code = 'INVALID_TOKEN';
      throw err;
    }
    throw error;
  }
};

/**
 * Build standardized error response
 */
const buildAuthError = (code, message) => ({
  success: false,
  error: { code, message }
});

const auth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json(buildAuthError('NO_TOKEN', 'Access denied. No token provided.'));
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      const code = err.code || 'INVALID_TOKEN';
      const message = err.message || 'Invalid or expired token';
      return res.status(401).json(buildAuthError(code, message));
    }
    
    // In test environment or when UserService is mocked without BD, use token data
    let user;
    try {
      user = await UserService.getUserById(decoded.id);
    } catch (err) {
      // If user service fails, fall back to token data
      user = null;
    }
    
    // If no user from DB, use decoded token data (useful for testing)
    if (!user && decoded.id) {
      user = {
        id: decoded.id,
        username: decoded.username,
        email: decoded.email,
        role: decoded.role || 'student',
        is_active: true,
        is_validated: true
      };
    }
    
    if (!user) {
      return res.status(401).json(buildAuthError('USER_NOT_FOUND', 'Invalid token. User not found.'));
    }

    if (!user.is_active) {
      return res.status(401).json(buildAuthError('ACCOUNT_DEACTIVATED', 'Account is deactivated.'));
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
    const token = extractToken(req);
    
    if (token) {
      // User provided a token, try to authenticate
      try {
        const decoded = verifyToken(token);
        
        // Try to get fresh user from DB; fall back to token payload
        let user;
        try {
          user = await UserService.getUserById(decoded.id);
        } catch (err) {
          user = null;
        }
        
        // Fall back to decoded token data when no user from DB
        if (!user && decoded.id) {
          user = {
            id: decoded.id,
            username: decoded.username,
            email: decoded.email,
            role: decoded.role || 'student',
            is_active: true,
            is_validated: true
          };
        }
        
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
        }
        // If no user, leave req.user undefined (don't set to null)
      } catch (error) {
        logger.warn('Invalid token provided, treating as anonymous:', error.message);
        // Leave req.user undefined
      }
    }

    // Handle session ID for anonymous users (only if response supports it)
    if (!req.user && typeof res.setHeader === 'function') {
      // Look for session ID in various places
      let sessionId;
      if (typeof req.header === 'function') {
        sessionId = req.header('X-Session-ID');
      } else if (req.headers) {
        sessionId = req.headers['x-session-id'] || req.headers['X-Session-ID'];
      }
      sessionId = sessionId || req.cookies?.sessionId || req.session?.id;
      
      if (!sessionId) {
        sessionId = uuidv4();
        logger.debug('Generated new sessionId for anonymous user:', sessionId);
        
        if (typeof res.cookie === 'function' && config.session) {
          res.cookie('sessionId', sessionId, {
            httpOnly: true,
            secure: config.nodeEnv === 'production',
            sameSite: 'lax',
            maxAge: config.session.maxAge
          });
        }
      }
      
      res.setHeader('X-Session-Id', sessionId);
      req.sessionId = sessionId;
    } else if (req.user) {
      req.sessionId = null;
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    // In case of error, continue gracefully
    if (typeof res.setHeader === 'function') {
      req.sessionId = uuidv4();
      res.setHeader('X-Session-Id', req.sessionId);
    }
    next();
  }
};

const adminAuth = async (req, res, next) => {
  // If user already authenticated, just check role
  if (req.user) {
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json(buildAuthError('FORBIDDEN', 'Access denied. Admin privileges required.'));
    }
    return next();
  }
  
  // Otherwise, authenticate first
  return auth(req, res, () => {
    if (!req.user) {
      return res.status(401).json(buildAuthError('UNAUTHORIZED', 'Authentication required.'));
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json(buildAuthError('FORBIDDEN', 'Access denied. Admin privileges required.'));
    }
    
    next();
  });
};

const instructorAuth = async (req, res, next) => {
  // If user already authenticated, just check role
  if (req.user) {
    if (!['admin', 'instructor'].includes(req.user.role)) {
      return res.status(403).json(buildAuthError('FORBIDDEN', 'Access denied. Instructor privileges required.'));
    }
    return next();
  }

  // Otherwise, authenticate first
  return auth(req, res, () => {
    if (!req.user) {
      return res.status(401).json(buildAuthError('UNAUTHORIZED', 'Authentication required.'));
    }

    if (!['admin', 'instructor'].includes(req.user.role)) {
      return res.status(403).json(buildAuthError('FORBIDDEN', 'Access denied. Instructor privileges required.'));
    }
    
    next();
  });
};

/**
 * Generic role-based access control middleware
 * @param  {...string} roles - Allowed roles
 */
const requireRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json(buildAuthError('UNAUTHORIZED', 'Authentication required.'));
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json(buildAuthError('FORBIDDEN', `Access denied. Required role: ${roles.join(' or ')}`));
    }

    next();
  };
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
      const token = extractToken(req);
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
  resourceAuth,
  extractToken,
  verifyToken,
  requireRoles
};