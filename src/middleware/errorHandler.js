/**
 * @fileoverview Error Handler Middleware
 * Provides ApiError class, error codes, and centralized error handling
 */

const logger = require('../utils/logger');

const ErrorCodes = {
  // Client errors (4xx)
  BAD_REQUEST: { code: 'BAD_REQUEST', statusCode: 400 },
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', statusCode: 422 },
  UNAUTHORIZED: { code: 'UNAUTHORIZED', statusCode: 401 },
  FORBIDDEN: { code: 'FORBIDDEN', statusCode: 403 },
  NOT_FOUND: { code: 'NOT_FOUND', statusCode: 404 },
  CONFLICT: { code: 'CONFLICT', statusCode: 409 },
  DUPLICATE_ENTRY: { code: 'DUPLICATE_ENTRY', statusCode: 409 },
  RATE_LIMITED: { code: 'RATE_LIMITED', statusCode: 429 },
  RATE_LIMIT: { code: 'RATE_LIMIT', statusCode: 429 },
  PAYLOAD_TOO_LARGE: { code: 'PAYLOAD_TOO_LARGE', statusCode: 413 },
  INVALID_JSON: { code: 'INVALID_JSON', statusCode: 400 },
  INVALID_TOKEN: { code: 'INVALID_TOKEN', statusCode: 401 },
  TOKEN_EXPIRED: { code: 'TOKEN_EXPIRED', statusCode: 401 },
  NO_TOKEN: { code: 'NO_TOKEN', statusCode: 401 },
  REFERENCE_ERROR: { code: 'REFERENCE_ERROR', statusCode: 400 },
  MISSING_FIELD: { code: 'MISSING_FIELD', statusCode: 400 },

  // Server errors (5xx)
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', statusCode: 500 },
  SERVICE_UNAVAILABLE: { code: 'SERVICE_UNAVAILABLE', statusCode: 503 },
  DATABASE_ERROR: { code: 'DATABASE_ERROR', statusCode: 503 },
  FOREIGN_KEY_VIOLATION: { code: 'FOREIGN_KEY_VIOLATION', statusCode: 400 },
  ROUTE_NOT_FOUND: { code: 'ROUTE_NOT_FOUND', statusCode: 404 },
};

/**
 * Helper to extract code string from ErrorCodes value or string
 */
const getErrorCode = (value) => {
  if (typeof value === 'string') return value;
  return value?.code || 'INTERNAL_ERROR';
};

class ApiError extends Error {
  constructor(message = 'An error occurred', statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = getErrorCode(code);
    // Preserve null when no details, otherwise array
    if (details === null || details === undefined) {
      this.details = null;
    } else {
      this.details = Array.isArray(details) ? details : [details];
    }
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      ...(this.details && this.details.length > 0 && { details: this.details }),
    };
  }
}

const createValidationError = (messageOrDetails, details = null) => {
  // If first arg is array, treat as details
  if (Array.isArray(messageOrDetails)) {
    return new ApiError('Validation failed', 422, 'VALIDATION_ERROR', messageOrDetails);
  }
  // If only string passed, that's the validation message - wrap as detail
  if (typeof messageOrDetails === 'string' && details === null) {
    return new ApiError('Validation failed', 422, 'VALIDATION_ERROR', [messageOrDetails]);
  }
  return new ApiError(messageOrDetails || 'Validation failed', 422, 'VALIDATION_ERROR', details);
};

const createNotFoundError = (resource = 'Resource') =>
  new ApiError(`${resource} not found`, 404, 'NOT_FOUND');

const createUnauthorizedError = (message = 'Authentication required') =>
  new ApiError(message, 401, 'UNAUTHORIZED');

const createForbiddenError = (message = 'Access denied') =>
  new ApiError(message, 403, 'FORBIDDEN');

const createConflictError = (message = 'Resource already exists') =>
  new ApiError(message, 409, 'CONFLICT');

const normalizeError = (err) => {
  if (err instanceof ApiError) {
    return {
      statusCode: err.statusCode,
      message: err.message,
      code: err.code,
      details: err.details,
    };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return { statusCode: 401, message: 'Invalid token', code: 'INVALID_TOKEN', details: [] };
  }
  if (err.name === 'TokenExpiredError') {
    return { statusCode: 401, message: 'Token expired', code: 'TOKEN_EXPIRED', details: [] };
  }

  // Prisma errors
  if (err.code === 'P2002') {
    const field = err.meta?.target?.[0];
    return {
      statusCode: 409,
      message: field ? `A record with this ${field} already exists` : 'Resource already exists',
      code: 'DUPLICATE_ENTRY',
      details: field ? [{ field }] : [],
    };
  }
  if (err.code === 'P2003') {
    return { statusCode: 400, message: 'Referenced resource not found', code: 'REFERENCE_ERROR', details: [] };
  }
  if (err.code === 'P2025') {
    return { statusCode: 404, message: 'Record not found', code: 'NOT_FOUND', details: [] };
  }

  // PostgreSQL errors (raw)
  if (err.code === '23505') {
    return { statusCode: 409, message: 'Resource already exists', code: 'DUPLICATE_ENTRY', details: [] };
  }
  if (err.code === '23503') {
    return { statusCode: 400, message: 'Referenced resource not found', code: 'REFERENCE_ERROR', details: [] };
  }
  if (err.code === '23502') {
    return { statusCode: 400, message: 'Required field is missing', code: 'MISSING_FIELD', details: [] };
  }

  // Database connection errors
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
    return { statusCode: 503, message: 'Database connection failed', code: 'DATABASE_ERROR', details: [] };
  }

  // Mongoose/Joi/Generic ValidationError
  if (err.name === 'ValidationError' || err.isJoi) {
    let details = [];
    if (err.details && Array.isArray(err.details)) {
      details = err.details.map((d) => ({ field: d.path?.join('.'), message: d.message }));
    } else if (err.errors && typeof err.errors === 'object') {
      details = Object.entries(err.errors).map(([field, e]) => ({
        field,
        message: e.message || String(e),
      }));
    }
    return { statusCode: 422, message: err.message || 'Validation failed', code: 'VALIDATION_ERROR', details };
  }

  // SyntaxError from JSON parsing - status may not always be set
  if (err instanceof SyntaxError && (err.status === 400 || err.message?.includes('JSON') || err.message?.toLowerCase().includes('token'))) {
    return { statusCode: 400, message: 'Invalid JSON in request body', code: 'INVALID_JSON', details: [] };
  }

  return {
    statusCode: err.statusCode || 500,
    message: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    details: err.details || [],
  };
};

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const normalized = normalizeError(err);
  const { statusCode, code } = normalized;
  let { message, details } = normalized;

  const errorContext = {
    message,
    code,
    statusCode,
    url: req.originalUrl || req.path,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id || null,
    sessionId: req.sessionId || null,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  };

  if (statusCode >= 500) {
    logger.error('Server Error:', errorContext);
  } else if (statusCode >= 400) {
    logger.warn('Client Error:', errorContext);
  }

  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal server error';
  }

  const response = {
    success: false,
    error: {
      message,
      code,
      ...(details && details.length > 0 && { details }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  };

  if (err.retryAfter) {
    res.set('Retry-After', err.retryAfter);
  }

  res.status(statusCode).json(response);
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const notFoundHandler = (req, res, next) => {
  const method = req.method || 'GET';
  const path = req.originalUrl || req.path || '/';
  const message = `Route ${method} ${path} not found`;

  // If next is provided as a real callback, delegate to error handler chain
  if (typeof next === 'function' && next.length === 0) {
    const error = new ApiError(message, 404, 'ROUTE_NOT_FOUND');
    return next(error);
  }

  // Otherwise respond directly
  if (res && typeof res.status === 'function') {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message,
      },
    });
  }
};

module.exports = errorHandler;
module.exports.errorHandler = errorHandler;
module.exports.ApiError = ApiError;
module.exports.ErrorCodes = ErrorCodes;
module.exports.asyncHandler = asyncHandler;
module.exports.notFoundHandler = notFoundHandler;
module.exports.createValidationError = createValidationError;
module.exports.createNotFoundError = createNotFoundError;
module.exports.createUnauthorizedError = createUnauthorizedError;
module.exports.createForbiddenError = createForbiddenError;
module.exports.createConflictError = createConflictError;
module.exports.normalizeError = normalizeError;
