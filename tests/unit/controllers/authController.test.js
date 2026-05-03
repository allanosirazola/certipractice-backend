/**
 * @fileoverview Auth Controller Tests
 */

jest.mock('../../../src/services/userService');
jest.mock('../../../src/models/User', () => ({
  validate: jest.fn().mockReturnValue([])
}));
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));
jest.mock('../../../src/config/config', () => ({
  security: { requireEmailVerification: false },
  jwt: { secret: 'test-secret', expiresIn: '24h' }
}));

describe('AuthController', () => {
  let mockReq;
  let mockRes;
  let authController;
  let UserService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    UserService = require('../../../src/services/userService');

    mockReq = {
      user: { id: 1, username: 'testuser', email: 'test@example.com' },
      body: {},
      params: {},
      headers: {}
    };

    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    authController = require('../../../src/controllers/authController');
  });

  describe('register', () => {
    it('should register user with valid data', async () => {
      mockReq.body = { username: 'newuser', email: 'new@example.com', password: 'SecurePass123!' };

      const mockUser = {
        id: 1,
        username: 'newuser',
        email: 'new@example.com',
        generateToken: jest.fn().mockReturnValue('jwt-token'),
        toJSON: jest.fn().mockReturnValue({ id: 1, username: 'newuser' })
      };

      UserService.createUser = jest.fn().mockResolvedValue(mockUser);

      await authController.register(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should reject registration without required fields', async () => {
      mockReq.body = { username: 'newuser' };

      await authController.register(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should handle duplicate email error', async () => {
      mockReq.body = { username: 'newuser', email: 'existing@example.com', password: 'SecurePass123!' };

      UserService.createUser = jest.fn().mockRejectedValue(new Error('Email already exists'));

      await authController.register(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
    });
  });

  describe('login', () => {
    it('should login with valid credentials', async () => {
      mockReq.body = { email: 'test@example.com', password: 'correctpassword' };

      const mockUser = {
        id: 1,
        username: 'testuser',
        is_active: true,
        is_validated: true,
        comparePassword: jest.fn().mockResolvedValue(true),
        updateLastLogin: jest.fn().mockResolvedValue(true),
        generateToken: jest.fn().mockReturnValue('jwt-token'),
        toJSON: jest.fn().mockReturnValue({ id: 1, username: 'testuser' })
      };

      UserService.getUserByEmail = jest.fn().mockResolvedValue(mockUser);

      await authController.login(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should reject invalid credentials', async () => {
      mockReq.body = { email: 'test@example.com', password: 'wrongpassword' };

      const mockUser = { comparePassword: jest.fn().mockResolvedValue(false) };

      UserService.getUserByEmail = jest.fn().mockResolvedValue(mockUser);

      await authController.login(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should reject deactivated accounts', async () => {
      mockReq.body = { email: 'test@example.com', password: 'correctpassword' };

      const mockUser = { is_active: false };

      UserService.getUserByEmail = jest.fn().mockResolvedValue(mockUser);

      await authController.login(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should allow login with username', async () => {
      mockReq.body = { username: 'testuser', password: 'correctpassword' };

      const mockUser = {
        id: 1,
        username: 'testuser',
        is_active: true,
        comparePassword: jest.fn().mockResolvedValue(true),
        updateLastLogin: jest.fn().mockResolvedValue(true),
        generateToken: jest.fn().mockReturnValue('jwt-token'),
        toJSON: jest.fn().mockReturnValue({ id: 1 })
      };

      UserService.getUserByUsername = jest.fn().mockResolvedValue(mockUser);

      await authController.login(mockReq, mockRes);

      expect(UserService.getUserByUsername).toHaveBeenCalledWith('testuser');
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token', async () => {
      const mockUser = {
        id: 1,
        username: 'testuser',
        is_active: true,
        toJSON: jest.fn().mockReturnValue({ id: 1, username: 'testuser' })
      };

      UserService.getUserById = jest.fn().mockResolvedValue(mockUser);

      await authController.verifyToken(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ valid: true }) })
      );
    });

    it('should reject if user not found', async () => {
      UserService.getUserById = jest.fn().mockResolvedValue(null);

      await authController.verifyToken(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should reject deactivated users', async () => {
      const mockUser = { id: 1, is_active: false };

      UserService.getUserById = jest.fn().mockResolvedValue(mockUser);

      await authController.verifyToken(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      const mockUser = {
        id: 1,
        username: 'testuser',
        getStats: jest.fn().mockResolvedValue({ exams: 5 }),
        toJSON: jest.fn().mockReturnValue({ id: 1, username: 'testuser' })
      };

      UserService.getUserById = jest.fn().mockResolvedValue(mockUser);

      await authController.getProfile(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('changePassword', () => {
    it('should change password with valid current password', async () => {
      mockReq.body = { currentPassword: 'oldPassword123!', newPassword: 'newPassword456!' };

      const mockUser = { comparePassword: jest.fn().mockResolvedValue(true) };

      UserService.getUserById = jest.fn().mockResolvedValue(mockUser);
      UserService.updateUser = jest.fn().mockResolvedValue({});

      await authController.changePassword(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Password changed successfully' })
      );
    });

    it('should reject incorrect current password', async () => {
      mockReq.body = { currentPassword: 'wrongPassword', newPassword: 'newPassword456!' };

      const mockUser = { comparePassword: jest.fn().mockResolvedValue(false) };

      UserService.getUserById = jest.fn().mockResolvedValue(mockUser);

      await authController.changePassword(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('logout', () => {
    it('should logout successfully', async () => {
      await authController.logout(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Logout successful' })
      );
    });
  });

  describe('refreshToken', () => {
    it('should refresh token for active user', async () => {
      const mockUser = {
        id: 1,
        is_active: true,
        generateToken: jest.fn().mockReturnValue('new-jwt-token'),
        toJSON: jest.fn().mockReturnValue({ id: 1 })
      };

      UserService.getUserById = jest.fn().mockResolvedValue(mockUser);

      await authController.refreshToken(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });
});
