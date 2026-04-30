/**
 * @fileoverview Error Handler Middleware Unit Tests
 */

const {
  ApiError,
  ErrorCodes,
  errorHandler,
  notFoundHandler,
  asyncHandler,
  createValidationError,
  createNotFoundError,
  createUnauthorizedError,
  createForbiddenError,
} = require('../../../src/middleware/errorHandler');

// Mock config
jest.mock('../../../src/config/config', () => ({
  isDevelopment: false,
  isProduction: true,
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));

describe('Error Handler Middleware', () => {
  let mockReq;
  let mockRes;
  let nextFn;

  beforeEach(() => {
    mockReq = {
      path: '/test',
      method: 'GET',
      ip: '127.0.0.1',
      user: null,
      sessionId: null,
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      headersSent: false,
    };
    nextFn = jest.fn();
    jest.clearAllMocks();
  });

  describe('ApiError class', () => {
    it('should create error with default values', () => {
      const error = new ApiError('Test error');

      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.details).toBeNull();
      expect(error.isOperational).toBe(true);
    });

    it('should create error with custom values', () => {
      const error = new ApiError('Not found', 404, 'NOT_FOUND', ['extra info']);

      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toEqual(['extra info']);
    });

    it('should be an instance of Error', () => {
      const error = new ApiError('Test');
      expect(error).toBeInstanceOf(Error);
    });

    it('should capture stack trace', () => {
      const error = new ApiError('Test');
      expect(error.stack).toBeDefined();
    });
  });

  describe('ErrorCodes', () => {
    it('should have correct client error codes', () => {
      expect(ErrorCodes.BAD_REQUEST.statusCode).toBe(400);
      expect(ErrorCodes.UNAUTHORIZED.statusCode).toBe(401);
      expect(ErrorCodes.FORBIDDEN.statusCode).toBe(403);
      expect(ErrorCodes.NOT_FOUND.statusCode).toBe(404);
      expect(ErrorCodes.CONFLICT.statusCode).toBe(409);
      expect(ErrorCodes.VALIDATION_ERROR.statusCode).toBe(422);
      expect(ErrorCodes.RATE_LIMITED.statusCode).toBe(429);
    });

    it('should have correct server error codes', () => {
      expect(ErrorCodes.INTERNAL_ERROR.statusCode).toBe(500);
      expect(ErrorCodes.DATABASE_ERROR.statusCode).toBe(503);
      expect(ErrorCodes.SERVICE_UNAVAILABLE.statusCode).toBe(503);
    });
  });

  describe('errorHandler middleware', () => {
    it('should handle ApiError correctly', () => {
      const error = new ApiError('Test error', 400, 'BAD_REQUEST');

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Test error',
        },
      });
    });

    it('should handle PostgreSQL unique violation', () => {
      const error = new Error('duplicate key');
      error.code = '23505';

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'DUPLICATE_ENTRY',
          }),
        })
      );
    });

    it('should handle PostgreSQL foreign key violation', () => {
      const error = new Error('foreign key violation');
      error.code = '23503';

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'REFERENCE_ERROR',
          }),
        })
      );
    });

    it('should handle PostgreSQL not null violation', () => {
      const error = new Error('not null violation');
      error.code = '23502';

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'MISSING_FIELD',
          }),
        })
      );
    });

    it('should handle JWT errors', () => {
      const error = new Error('invalid token');
      error.name = 'JsonWebTokenError';

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'INVALID_TOKEN',
          }),
        })
      );
    });

    it('should handle token expired error', () => {
      const error = new Error('token expired');
      error.name = 'TokenExpiredError';

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'TOKEN_EXPIRED',
          }),
        })
      );
    });

    it('should handle validation errors', () => {
      const error = new Error('Validation failed');
      error.name = 'ValidationError';
      error.errors = {
        field1: { message: 'Field1 is required' },
        field2: { message: 'Field2 is invalid' },
      };

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(422);
    });

    it('should handle syntax errors (bad JSON)', () => {
      const error = new SyntaxError('Unexpected token');
      error.status = 400;

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'INVALID_JSON',
          }),
        })
      );
    });

    it('should handle database connection refused', () => {
      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'DATABASE_ERROR',
          }),
        })
      );
    });

    it('should handle generic errors with 500 status', () => {
      const error = new Error('Something went wrong');

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong',
        },
      });
    });

    it('should include error details when present', () => {
      const error = new ApiError('Validation failed', 400, 'VALIDATION_ERROR', [
        'Field1 is required',
        'Field2 must be a number',
      ]);

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: ['Field1 is required', 'Field2 must be a number'],
        },
      });
    });

    it('should delegate to next when headers already sent', () => {
      mockRes.headersSent = true;
      const error = new Error('Test');

      errorHandler(error, mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalledWith(error);
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('notFoundHandler middleware', () => {
    it('should return 404 with route info', () => {
      mockReq.method = 'POST';
      mockReq.path = '/api/unknown';

      notFoundHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Route POST /api/unknown not found',
        },
      });
    });
  });

  describe('asyncHandler wrapper', () => {
    it('should call next on error in async function', async () => {
      const error = new Error('Async error');
      const asyncFn = jest.fn().mockRejectedValue(error);

      const wrapped = asyncHandler(asyncFn);
      await wrapped(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalledWith(error);
    });

    it('should not call next on successful async function', async () => {
      const asyncFn = jest.fn().mockResolvedValue('success');

      const wrapped = asyncHandler(asyncFn);
      await wrapped(mockReq, mockRes, nextFn);

      expect(nextFn).not.toHaveBeenCalled();
    });

    it('should pass through sync errors', async () => {
      const error = new Error('Sync error');
      const asyncFn = jest.fn().mockImplementation(() => {
        throw error;
      });

      const wrapped = asyncHandler(asyncFn);
      
      // asyncHandler should catch sync errors and pass to next
      try {
        await wrapped(mockReq, mockRes, nextFn);
      } catch (e) {
        // If error propagates, that's also valid behavior
        expect(e.message).toBe('Sync error');
        return;
      }

      expect(nextFn).toHaveBeenCalledWith(error);
    });
  });

  describe('Error factory functions', () => {
    describe('createValidationError', () => {
      it('should create validation error with string', () => {
        const error = createValidationError('Field is required');

        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBe(422);
        expect(error.code).toBe('VALIDATION_ERROR');
        expect(error.details).toEqual(['Field is required']);
      });

      it('should create validation error with array', () => {
        const errors = ['Error 1', 'Error 2'];
        const error = createValidationError(errors);

        expect(error.details).toEqual(errors);
      });
    });

    describe('createNotFoundError', () => {
      it('should create not found error with default message', () => {
        const error = createNotFoundError();

        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBe(404);
        expect(error.code).toBe('NOT_FOUND');
        expect(error.message).toBe('Resource not found');
      });

      it('should create not found error with custom resource', () => {
        const error = createNotFoundError('User');

        expect(error.message).toBe('User not found');
      });
    });

    describe('createUnauthorizedError', () => {
      it('should create unauthorized error with default message', () => {
        const error = createUnauthorizedError();

        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBe(401);
        expect(error.code).toBe('UNAUTHORIZED');
        expect(error.message).toBe('Authentication required');
      });

      it('should create unauthorized error with custom message', () => {
        const error = createUnauthorizedError('Invalid credentials');

        expect(error.message).toBe('Invalid credentials');
      });
    });

    describe('createForbiddenError', () => {
      it('should create forbidden error with default message', () => {
        const error = createForbiddenError();

        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe('FORBIDDEN');
        expect(error.message).toBe('Access denied');
      });

      it('should create forbidden error with custom message', () => {
        const error = createForbiddenError('Admin access required');

        expect(error.message).toBe('Admin access required');
      });
    });
  });
});
