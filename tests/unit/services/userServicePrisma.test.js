/**
 * @fileoverview Regression: userService.createUser uses the Prisma-backed
 * repository, not the legacy static methods on the User model.
 *
 * Before the fix, calling POST /api/auth/register threw
 * "User.findByEmail is not a function" because userService still called
 * User.findByEmail / User.findByUsername / new User(...).save(), all of
 * which were removed in the Prisma migration.
 */

// Mock prisma client BEFORE the repository loads it
jest.mock('../../../src/lib/prisma', () => ({
  user: {
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
  $disconnect: jest.fn(),
  $on:         jest.fn(),
}));

// Mock the repository module so we can assert which methods are called
jest.mock('../../../src/repositories', () => ({
  userRepository: {
    findByEmail:    jest.fn(),
    findByUsername: jest.fn(),
    findById:       jest.fn(),
    create:         jest.fn(),
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../../src/config/config', () => ({
  jwt: { secret: 's', expiresIn: '7d', algorithm: 'HS256' },
  bcrypt: { rounds: 4 },
  isTest: true,
}));

const { userRepository } = require('../../../src/repositories');
const UserService = require('../../../src/services/userService');
const User = require('../../../src/models/User');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('userService.createUser — Prisma integration', () => {
  it('does NOT call User.findByEmail (legacy method removed)', async () => {
    // The model should not even expose this method anymore.
    expect(User.findByEmail).toBeUndefined();
    expect(User.findByUsername).toBeUndefined();
  });

  it('looks up duplicates via the repository (not the model)', async () => {
    userRepository.findByEmail.mockResolvedValue(null);
    userRepository.findByUsername.mockResolvedValue(null);
    userRepository.create.mockResolvedValue({
      id: 1, username: 'alice', email: 'alice@example.com', role: 'student',
    });

    await UserService.createUser({
      username: 'alice', email: 'alice@example.com', password: 'SecurePass123',
    });

    expect(userRepository.findByEmail).toHaveBeenCalledWith('alice@example.com');
    expect(userRepository.findByUsername).toHaveBeenCalledWith('alice');
    expect(userRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      username: 'alice',
      email: 'alice@example.com',
      password: 'SecurePass123',
    }));
  });

  it('returns an object that exposes generateToken() and toJSON()', async () => {
    userRepository.findByEmail.mockResolvedValue(null);
    userRepository.findByUsername.mockResolvedValue(null);
    userRepository.create.mockResolvedValue({
      id: 7, username: 'bob', email: 'bob@x.com', role: 'student',
      passwordHash: 'should-be-hidden',
    });
    const user = await UserService.createUser({
      username: 'bob', email: 'bob@x.com', password: 'SecurePass123',
    });
    expect(typeof user.generateToken).toBe('function');
    expect(typeof user.toJSON).toBe('function');
    expect(typeof user.generateToken()).toBe('string');
    // toJSON must strip passwordHash
    expect(user.toJSON().passwordHash).toBeUndefined();
    expect(user.toJSON().email).toBe('bob@x.com');
  });

  it('throws when email already exists', async () => {
    userRepository.findByEmail.mockResolvedValue({ id: 99, email: 'x@y.com' });
    await expect(UserService.createUser({
      username: 'alice', email: 'x@y.com', password: 'SecurePass123',
    })).rejects.toThrow(/email already exists/i);
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it('throws when username already exists', async () => {
    userRepository.findByEmail.mockResolvedValue(null);
    userRepository.findByUsername.mockResolvedValue({ id: 99, username: 'a' });
    await expect(UserService.createUser({
      username: 'alice', email: 'x@y.com', password: 'SecurePass123',
    })).rejects.toThrow(/username already exists/i);
    expect(userRepository.create).not.toHaveBeenCalled();
  });
});
