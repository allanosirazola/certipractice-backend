/**
 * @fileoverview User Repository Tests
 */

const { mockPrisma, resetMocks } = require('../../mocks/prisma.mock');

// Mock Prisma before requiring repository
jest.mock('../../../src/lib/prisma', () => mockPrisma);
jest.mock('../../../src/config/config', () => ({
  bcrypt: { rounds: 4 },
}));

describe('UserRepository', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('findById', () => {
    it('should find user by id', async () => {
      const mockUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        role: 'student',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const userRepository = require('../../../src/repositories/userRepository');
      const user = await userRepository.findById(1);

      expect(user).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
        })
      );
    });

    it('should return null for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const userRepository = require('../../../src/repositories/userRepository');
      const user = await userRepository.findById(999);

      expect(user).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should find user by email (case insensitive)', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
      };

      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      const userRepository = require('../../../src/repositories/userRepository');
      const user = await userRepository.findByEmail('TEST@EXAMPLE.COM');

      expect(user).toEqual(mockUser);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            email: expect.objectContaining({
              equals: 'TEST@EXAMPLE.COM',
              mode: 'insensitive',
            }),
          }),
        })
      );
    });
  });

  describe('create', () => {
    it('should create a new user with hashed password', async () => {
      const userData = {
        username: 'newuser',
        email: 'new@example.com',
        password: 'SecurePassword123',
      };

      const createdUser = {
        id: 1,
        username: 'newuser',
        email: 'new@example.com',
        role: 'student',
      };

      mockPrisma.user.create.mockResolvedValue(createdUser);

      const userRepository = require('../../../src/repositories/userRepository');
      const user = await userRepository.create(userData);

      expect(user.id).toBe(1);
      expect(user.username).toBe('newuser');
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            username: 'newuser',
            email: 'new@example.com',
            passwordHash: expect.any(String),
          }),
        })
      );
    });
  });

  describe('update', () => {
    it('should update allowed fields', async () => {
      const updatedUser = {
        id: 1,
        firstName: 'Updated',
        lastName: 'User',
      };

      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const userRepository = require('../../../src/repositories/userRepository');
      const user = await userRepository.update(1, {
        firstName: 'Updated',
        lastName: 'User',
      });

      expect(user.firstName).toBe('Updated');
    });

    it('should ignore non-allowed fields', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 1 });

      const userRepository = require('../../../src/repositories/userRepository');
      await userRepository.update(1, {
        passwordHash: 'hacked', // Not allowed
      });

      // Should not call update with empty data
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete user and return true', async () => {
      mockPrisma.user.delete.mockResolvedValue({ id: 1 });

      const userRepository = require('../../../src/repositories/userRepository');
      const result = await userRepository.delete(1);

      expect(result).toBe(true);
    });

    it('should return false for non-existent user', async () => {
      mockPrisma.user.delete.mockRejectedValue({ code: 'P2025' });

      const userRepository = require('../../../src/repositories/userRepository');
      const result = await userRepository.delete(999);

      expect(result).toBe(false);
    });
  });

  describe('emailExists', () => {
    it('should return true if email exists', async () => {
      mockPrisma.user.count.mockResolvedValue(1);

      const userRepository = require('../../../src/repositories/userRepository');
      const exists = await userRepository.emailExists('existing@example.com');

      expect(exists).toBe(true);
    });

    it('should return false if email does not exist', async () => {
      mockPrisma.user.count.mockResolvedValue(0);

      const userRepository = require('../../../src/repositories/userRepository');
      const exists = await userRepository.emailExists('new@example.com');

      expect(exists).toBe(false);
    });
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      const mockUsers = [
        { id: 1, username: 'user1' },
        { id: 2, username: 'user2' },
      ];

      mockPrisma.user.findMany.mockResolvedValue(mockUsers);
      mockPrisma.user.count.mockResolvedValue(10);

      const userRepository = require('../../../src/repositories/userRepository');
      const result = await userRepository.findAll({ page: 1, limit: 2 });

      expect(result.users).toHaveLength(2);
      expect(result.total).toBe(10);
      expect(result.totalPages).toBe(5);
    });

    it('should filter by role', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      const userRepository = require('../../../src/repositories/userRepository');
      await userRepository.findAll({ role: 'admin' });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: 'admin',
          }),
        })
      );
    });
  });
});
