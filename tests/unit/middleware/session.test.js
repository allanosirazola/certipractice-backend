/**
 * @fileoverview Session Middleware Unit Tests
 */

const {
  sessionMiddleware,
  requireIdentity,
  getIdentifier,
  isValidUUID,
} = require('../../../src/middleware/session');

// Mock config
jest.mock('../../../src/config/config', () => ({
  session: {
    useCookies: true,
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 86400000,
  },
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
}));

describe('Session Middleware', () => {
  let mockReq;
  let mockRes;
  let nextFn;

  beforeEach(() => {
    mockReq = {
      headers: {},
      cookies: {},
    };
    mockRes = {
      setHeader: jest.fn(),
      cookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFn = jest.fn();
  });

  describe('isValidUUID()', () => {
    it('should validate correct UUID v4', () => {
      expect(isValidUUID('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
      expect(isValidUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
      expect(isValidUUID('')).toBe(false);
      expect(isValidUUID('123')).toBe(false);
      expect(isValidUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(false); // v1
      expect(isValidUUID('123e4567-e89b-52d3-a456-426614174000')).toBe(false); // v5
    });

    it('should reject UUIDs with wrong variant', () => {
      // Variant must be 8, 9, a, or b
      expect(isValidUUID('123e4567-e89b-42d3-0456-426614174000')).toBe(false);
      expect(isValidUUID('123e4567-e89b-42d3-7456-426614174000')).toBe(false);
    });
  });

  describe('sessionMiddleware', () => {
    it('should create new session ID when none provided', () => {
      sessionMiddleware(mockReq, mockRes, nextFn);

      expect(mockReq.sessionId).toBeDefined();
      expect(isValidUUID(mockReq.sessionId)).toBe(true);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Session-Id', mockReq.sessionId);
      expect(nextFn).toHaveBeenCalled();
    });

    it('should use session ID from header', () => {
      const sessionId = '123e4567-e89b-42d3-a456-426614174000';
      mockReq.headers['x-session-id'] = sessionId;

      sessionMiddleware(mockReq, mockRes, nextFn);

      expect(mockReq.sessionId).toBe(sessionId);
      expect(nextFn).toHaveBeenCalled();
    });

    it('should use session ID from cookie', () => {
      const sessionId = '123e4567-e89b-42d3-a456-426614174000';
      mockReq.cookies.sessionId = sessionId;

      sessionMiddleware(mockReq, mockRes, nextFn);

      expect(mockReq.sessionId).toBe(sessionId);
    });

    it('should prioritize header over cookie', () => {
      const headerSessionId = '123e4567-e89b-42d3-a456-426614174000';
      const cookieSessionId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

      mockReq.headers['x-session-id'] = headerSessionId;
      mockReq.cookies.sessionId = cookieSessionId;

      sessionMiddleware(mockReq, mockRes, nextFn);

      expect(mockReq.sessionId).toBe(headerSessionId);
    });

    it('should generate new session ID for invalid format', () => {
      mockReq.headers['x-session-id'] = 'invalid-session-id';

      sessionMiddleware(mockReq, mockRes, nextFn);

      expect(mockReq.sessionId).not.toBe('invalid-session-id');
      expect(isValidUUID(mockReq.sessionId)).toBe(true);
    });

    it('should set session in response header', () => {
      sessionMiddleware(mockReq, mockRes, nextFn);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'X-Session-Id',
        expect.any(String)
      );
    });

    it('should set session cookie', () => {
      sessionMiddleware(mockReq, mockRes, nextFn);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'sessionId',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          maxAge: 86400000,
        })
      );
    });
  });

  describe('requireIdentity middleware', () => {
    it('should allow request with authenticated user', () => {
      mockReq.user = { id: 1 };

      requireIdentity(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
    });

    it('should allow request with session ID', () => {
      mockReq.sessionId = '123e4567-e89b-42d3-a456-426614174000';

      requireIdentity(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
    });

    it('should reject request without identity', () => {
      requireIdentity(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'IDENTITY_REQUIRED',
          message: 'Authentication or session required',
        },
      });
      expect(nextFn).not.toHaveBeenCalled();
    });

    it('should allow request with both user and session', () => {
      mockReq.user = { id: 1 };
      mockReq.sessionId = '123e4567-e89b-42d3-a456-426614174000';

      requireIdentity(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
    });
  });

  describe('getIdentifier()', () => {
    it('should return user identifier for authenticated user', () => {
      mockReq.user = { id: 123 };
      mockReq.sessionId = 'session-123';

      const result = getIdentifier(mockReq);

      expect(result).toEqual({ type: 'user', id: 123 });
    });

    it('should return session identifier for anonymous user', () => {
      mockReq.sessionId = 'session-123';

      const result = getIdentifier(mockReq);

      expect(result).toEqual({ type: 'session', id: 'session-123' });
    });

    it('should return null when no identity', () => {
      const result = getIdentifier(mockReq);

      expect(result).toBeNull();
    });

    it('should prioritize user over session', () => {
      mockReq.user = { id: 456 };
      mockReq.sessionId = 'session-789';

      const result = getIdentifier(mockReq);

      expect(result.type).toBe('user');
      expect(result.id).toBe(456);
    });
  });
});
