const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * Global error handler middleware
 * Handles all types of errors with proper logging and response formatting
 */
const errorHandler = (err, req, res, next) => {
  // Default values
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let code = err.code || 'INTERNAL_ERROR';
  let errors = err.errors || [];

  // Log error with context
  const errorContext = {
    message: err.message,
    code,
    statusCode,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id || null,
    sessionId: req.sessionId || null,
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
    }),
  };

  // Log based on severity
  if (statusCode >= 500) {
    logger.error('Server Error:', errorContext);
  } else if (statusCode >= 400) {
    logger.warn('Client Error:', errorContext);
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    code = 'INVALID_TOKEN';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    code = 'TOKEN_EXPIRED';
  }

  // Handle Prisma errors
  if (err.code === 'P2002') {
    statusCode = 409;
    message = 'Resource already exists';
    code = 'DUPLICATE_ENTRY';
    const field = err.meta?.target?.[0];
    if (field) {
      message = `A record with this ${field} already exists`;
    }
  }

  if (err.code === 'P2003') {
    statusCode = 400;
    message = 'Referenced resource not found';
    code = 'FOREIGN_KEY_VIOLATION';
  }

  if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Record not found';
    code = 'NOT_FOUND';
  }

  // Handle PostgreSQL errors (legacy support)
  if (err.code === '23505') {
    statusCode = 409;
    message = 'Resource already exists';
    code = 'DUPLICATE_ENTRY';
  }

  if (err.code === '23503') {
    statusCode = 400;
    message = 'Referenced resource not found';
    code = 'FOREIGN_KEY_VIOLATION';
  }

  // Handle validation errors
  if (err.name === 'ValidationError' || err.isJoi) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    if (err.details) {
      errors = err.details.map(d => ({
        field: d.path?.join('.'),
        message: d.message,
      }));
    }
  }

  // Handle syntax errors in JSON body
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    message = 'Invalid JSON in request body';
    code = 'INVALID_JSON';
  }

  // Hide internal error details in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal server error';
  }

  // Build response
  const response = {
    success: false,
    error: {
      message,
      code,
      ...(errors.length > 0 && { details: errors }),
      ...(process.env.NODE_ENV === 'development' && { 
        stack: err.stack,
      }),
    },
  };

  // Set appropriate headers
  if (err.retryAfter) {
    res.set('Retry-After', err.retryAfter);
  }

  res.status(statusCode).json(response);
};

/**
 * Async handler wrapper to catch errors in async route handlers
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Not found handler for undefined routes
 */
const notFoundHandler = (req, res, next) => {
  const error = new AppError(`Route ${req.originalUrl} not found`, 404, 'ROUTE_NOT_FOUND');
  next(error);
};

module.exports = errorHandler;
module.exports.asyncHandler = asyncHandler;
module.exports.notFoundHandler = notFoundHandler;
