/**
 * @fileoverview Session Middleware
 * Manages session IDs for anonymous users
 */

const { v4: uuidv4 } = require('uuid');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Validate UUID v4 format strictly
 * UUID v4: xxxxxxxx-xxxx-4xxx-[8|9|a|b]xxx-xxxxxxxxxxxx
 */
const isValidUUID = (uuid) => {
  if (!uuid || typeof uuid !== 'string') return false;
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(uuid);
};

/**
 * Extract session ID from request (header or cookie)
 */
const extractSessionId = (req) => {
  let sessionId;

  // Check header first (X-Session-Id)
  if (req.headers) {
    sessionId = req.headers['x-session-id'] || req.headers['X-Session-Id'] || req.headers['X-Session-ID'];
  } else if (typeof req.header === 'function') {
    sessionId = req.header('X-Session-Id') || req.header('x-session-id');
  }

  // Then cookie
  if (!sessionId && req.cookies) {
    sessionId = req.cookies.sessionId;
  }

  return sessionId;
};

/**
 * Session middleware - ensures every request has a sessionId
 */
const sessionMiddleware = (req, res, next) => {
  let sessionId = extractSessionId(req);

  // If invalid format, generate new one
  if (!sessionId || !isValidUUID(sessionId)) {
    if (sessionId) {
      logger.warn(`Invalid session ID format received, generating new one`);
    }
    sessionId = uuidv4();
  }

  req.sessionId = sessionId;

  // Set response header
  if (typeof res.setHeader === 'function') {
    res.setHeader('X-Session-Id', sessionId);
  }

  // Set cookie if configured and supported
  const sessionConfig = config.session || {};
  if (sessionConfig.useCookies !== false && typeof res.cookie === 'function') {
    res.cookie('sessionId', sessionId, {
      httpOnly: sessionConfig.httpOnly !== false,
      secure: sessionConfig.secure || false,
      sameSite: sessionConfig.sameSite || 'lax',
      maxAge: sessionConfig.maxAge || 86400000, // 24h default
    });
  }

  next();
};

/**
 * Require either authenticated user or session ID
 */
const requireIdentity = (req, res, next) => {
  if (req.user || req.sessionId) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: {
      code: 'IDENTITY_REQUIRED',
      message: 'Authentication or session required',
    },
  });
};

/**
 * Get the identifier (user or session) from the request
 * Returns { type: 'user' | 'session', id } or null
 */
const getIdentifier = (req) => {
  if (req.user && req.user.id !== undefined && req.user.id !== null) {
    return { type: 'user', id: req.user.id };
  }
  if (req.sessionId) {
    return { type: 'session', id: req.sessionId };
  }
  return null;
};

module.exports = {
  sessionMiddleware,
  requireIdentity,
  getIdentifier,
  isValidUUID,
  extractSessionId,
};
