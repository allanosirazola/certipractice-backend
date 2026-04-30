/**
 * @fileoverview Auth Middleware Unit Tests
 */

const jwt = require('jsonwebtoken');
const {
  auth,
  optionalAuth,
  adminAuth,
  instructorAuth,
  requireRoles,
  extractToken,
  verifyToken,
} = require('../../../src/middleware/auth');
const { users, tokens } = require('../../fixtures');

// Mock config
jest.mock('../../../src/config/config', () => ({
  jwt: {
    secret: 'test-jwt-secret-at-least-32-characters-long',
    algorithm: 'HS256',
  },
}));

describe('Auth Middleware', () => {
  let mockReq;
  let mockRes;
  let nextFn;

  beforeEach(() => {
    mockReq = {
      headers: {},
      query: {},
      cookies: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFn = jest.fn();
  });

  describe('extractToken()', () => {
    it('should extract token from Authorization header', () => {
      mockReq.headers.authorization = 'Bearer valid-token-here';
      expect(extractToken(mockReq)).toBe('valid-token-here');
    });

    it('should extract token from query parameter', () => {
      mockReq.query.token = 'query-token';
      expect(extractToken(mockReq)).toBe('query-token');
    });

    it('should extract token from cookies', () => {
      mockReq.cookies.token = 'cookie-token';
      expect(extractToken(mockReq)).toBe('cookie-token');
    });

    it('should return null when no token present', () => {
      expect(extractToken(mockReq)).toBeNull();
    });

    it('should prioritize Authorization header', () => {
      mockReq.headers.authorization = 'Bearer header-token';
      mockReq.query.token = 'query-token';
      mockReq.cookies.token = 'cookie-token';
      expect(extractToken(mockReq)).toBe('header-token');
    });

    it('should ignore malformed Authorization header', () => {
      mockReq.headers.authorization = 'InvalidFormat token';
      expect(extractToken(mockReq)).toBeNull();
    });
  });

  describe('verifyToken()', () => {
    const secret = 'test-jwt-secret-at-least-32-characters-long';

    it('should verify valid token', () => {
      const payload = { id: 1, email: 'test@test.com', role: 'student' };
      const token = jwt.sign(payload, secret);

      const decoded = verifyToken(token);
      expect(decoded.id).toBe(1);
      expect(decoded.email).toBe('test@test.com');
      expect(decoded.role).toBe('student');
    });

    it('should throw for expired token', () => {
      const token = jwt.sign({ id: 1 }, secret, { expiresIn: '-1s' });

      expect(() => verifyToken(token)).toThrow('Token has expired');
    });

    it('should throw for invalid token', () => {
      expect(() => verifyToken('invalid-token')).toThrow('Invalid token');
    });

    it('should throw for token with wrong secret', () => {
      const token = jwt.sign({ id: 1 }, 'wrong-secret');
      expect(() => verifyToken(token)).toThrow('Invalid token');
    });
  });

  describe('auth middleware', () => {
    const secret = 'test-jwt-secret-at-least-32-characters-long';

    it('should authenticate valid token', async () => {
      const token = jwt.sign(tokens.student, secret);
      mockReq.headers.authorization = `Bearer ${token}`;

      await auth(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user.id).toBe(tokens.student.id);
      expect(mockReq.user.email).toBe(tokens.student.email);
      expect(mockReq.user.role).toBe('student');
    });

    it('should set isAdmin flag for admin users', async () => {
      const token = jwt.sign(tokens.admin, secret);
      mockReq.headers.authorization = `Bearer ${token}`;

      await auth(mockReq, mockRes, nextFn);

      expect(mockReq.user.isAdmin).toBe(true);
      expect(mockReq.user.isInstructor).toBe(true);
    });

    it('should set isInstructor flag for instructor users', async () => {
      const token = jwt.sign(tokens.instructor, secret);
      mockReq.headers.authorization = `Bearer ${token}`;

      await auth(mockReq, mockRes, nextFn);

      expect(mockReq.user.isAdmin).toBe(false);
      expect(mockReq.user.isInstructor).toBe(true);
    });

    it('should reject request without token', async () => {
      await auth(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'NO_TOKEN',
          }),
        })
      );
      expect(nextFn).not.toHaveBeenCalled();
    });

    it('should reject invalid token', async () => {
      mockReq.headers.authorization = 'Bearer invalid-token';

      await auth(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(nextFn).not.toHaveBeenCalled();
    });

    it('should reject expired token', async () => {
      const token = jwt.sign(tokens.student, secret, { expiresIn: '-1s' });
      mockReq.headers.authorization = `Bearer ${token}`;

      await auth(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'TOKEN_EXPIRED',
          }),
        })
      );
    });
  });

  describe('optionalAuth middleware', () => {
    const secret = 'test-jwt-secret-at-least-32-characters-long';

    it('should attach user for valid token', async () => {
      const token = jwt.sign(tokens.student, secret);
      mockReq.headers.authorization = `Bearer ${token}`;

      await optionalAuth(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user.id).toBe(tokens.student.id);
    });

    it('should continue without user when no token', async () => {
      await optionalAuth(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });

    it('should continue without user when token is invalid', async () => {
      mockReq.headers.authorization = 'Bearer invalid-token';

      await optionalAuth(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });
  });

  describe('adminAuth middleware', () => {
    it('should allow admin users', () => {
      mockReq.user = { id: 1, role: 'admin', isAdmin: true };

      adminAuth(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
    });

    it('should reject non-admin users', () => {
      mockReq.user = { id: 1, role: 'student', isAdmin: false };

      adminAuth(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'FORBIDDEN',
          }),
        })
      );
      expect(nextFn).not.toHaveBeenCalled();
    });

    it('should reject unauthenticated users', () => {
      adminAuth(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(nextFn).not.toHaveBeenCalled();
    });
  });

  describe('instructorAuth middleware', () => {
    it('should allow admin users', () => {
      mockReq.user = { id: 1, role: 'admin', isInstructor: true };

      instructorAuth(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
    });

    it('should allow instructor users', () => {
      mockReq.user = { id: 1, role: 'instructor', isInstructor: true };

      instructorAuth(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
    });

    it('should reject student users', () => {
      mockReq.user = { id: 1, role: 'student', isInstructor: false };

      instructorAuth(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(nextFn).not.toHaveBeenCalled();
    });
  });

  describe('requireRoles middleware', () => {
    it('should allow users with matching role', () => {
      mockReq.user = { id: 1, role: 'instructor' };
      const middleware = requireRoles('instructor', 'admin');

      middleware(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
    });

    it('should reject users without matching role', () => {
      mockReq.user = { id: 1, role: 'student' };
      const middleware = requireRoles('instructor', 'admin');

      middleware(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(nextFn).not.toHaveBeenCalled();
    });

    it('should reject unauthenticated users', () => {
      const middleware = requireRoles('admin');

      middleware(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(nextFn).not.toHaveBeenCalled();
    });
  });
});
