/**
 * @fileoverview Custom Error Classes
 * Centralized error handling with proper HTTP status codes
 */

/**
 * Base application error
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      error: {
        message: this.message,
        code: this.code,
        ...(process.env.NODE_ENV === 'development' && { stack: this.stack }),
      },
    };
  }
}

/**
 * Validation error (400)
 */
class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      errors: this.errors,
    };
  }
}

/**
 * Authentication error (401)
 */
class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * Authorization/Forbidden error (403)
 */
class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * Not found error (404)
 */
class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.resource = resource;
  }
}

/**
 * Conflict error (409)
 */
class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * Rate limit error (429)
 */
class RateLimitError extends AppError {
  constructor(retryAfter = 60) {
    super('Too many requests, please try again later', 429, 'RATE_LIMIT_EXCEEDED');
    this.retryAfter = retryAfter;
  }
}

/**
 * Database error (500)
 */
class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super(message, 500, 'DATABASE_ERROR');
  }
}

/**
 * External service error (502)
 */
class ExternalServiceError extends AppError {
  constructor(service, message = 'External service unavailable') {
    super(message, 502, 'EXTERNAL_SERVICE_ERROR');
    this.service = service;
  }
}

/**
 * Business logic error (422)
 */
class BusinessError extends AppError {
  constructor(message, code = 'BUSINESS_ERROR') {
    super(message, 422, code);
  }
}

/**
 * Exam-specific errors
 */
class ExamError extends BusinessError {
  constructor(message, code = 'EXAM_ERROR') {
    super(message, code);
  }
}

class ExamNotStartedError extends ExamError {
  constructor() {
    super('Exam has not been started', 'EXAM_NOT_STARTED');
  }
}

class ExamAlreadyCompletedError extends ExamError {
  constructor() {
    super('Exam has already been completed', 'EXAM_ALREADY_COMPLETED');
  }
}

class ExamTimeExpiredError extends ExamError {
  constructor() {
    super('Exam time has expired', 'EXAM_TIME_EXPIRED');
  }
}

class InsufficientQuestionsError extends ExamError {
  constructor(available, required) {
    super(`Not enough questions available. Required: ${required}, Available: ${available}`, 'INSUFFICIENT_QUESTIONS');
    this.available = available;
    this.required = required;
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DatabaseError,
  ExternalServiceError,
  BusinessError,
  ExamError,
  ExamNotStartedError,
  ExamAlreadyCompletedError,
  ExamTimeExpiredError,
  InsufficientQuestionsError,
};
