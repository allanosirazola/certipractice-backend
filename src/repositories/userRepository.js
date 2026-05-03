/**
 * @fileoverview User Repository
 * Handles all database operations for users using Prisma
 */

const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const config = require('../config/config');

class UserRepository {
  /**
   * Find user by ID
   * @param {number} id - User ID
   * @param {boolean} includePassword - Include password hash in result
   * @returns {Promise<Object|null>}
   */
  async findById(id, includePassword = false) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: this._getUserSelect(includePassword),
    });
    return user;
  }

  /**
   * Find user by email (case insensitive)
   * @param {string} email - User email
   * @param {boolean} includePassword - Include password hash in result
   * @returns {Promise<Object|null>}
   */
  async findByEmail(email, includePassword = false) {
    const user = await prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
      },
      select: this._getUserSelect(includePassword),
    });
    return user;
  }

  /**
   * Find user by username (case insensitive)
   * @param {string} username - Username
   * @param {boolean} includePassword - Include password hash in result
   * @returns {Promise<Object|null>}
   */
  async findByUsername(username, includePassword = false) {
    const user = await prisma.user.findFirst({
      where: {
        username: { equals: username, mode: 'insensitive' },
      },
      select: this._getUserSelect(includePassword),
    });
    return user;
  }

  /**
   * Find user by email or username
   * @param {string} emailOrUsername - Email or username
   * @param {boolean} includePassword - Include password hash in result
   * @returns {Promise<Object|null>}
   */
  async findByEmailOrUsername(emailOrUsername, includePassword = false) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: emailOrUsername, mode: 'insensitive' } },
          { username: { equals: emailOrUsername, mode: 'insensitive' } },
        ],
      },
      select: this._getUserSelect(includePassword),
    });
    return user;
  }

  /**
   * Create a new user
   * @param {Object} data - User data
   * @returns {Promise<Object>}
   */
  async create(data) {
    const passwordHash = await bcrypt.hash(data.password, config.bcrypt.rounds);

    const user = await prisma.user.create({
      data: {
        username: data.username,
        email: data.email.toLowerCase(),
        passwordHash,
        firstName: data.firstName || null,
        lastName: data.lastName || null,
        role: data.role || 'student',
      },
      select: this._getUserSelect(false),
    });

    return user;
  }

  /**
   * Update user by ID
   * @param {number} id - User ID
   * @param {Object} data - Fields to update
   * @returns {Promise<Object|null>}
   */
  async update(id, data) {
    // Only allow specific fields to be updated
    const allowedFields = ['firstName', 'lastName', 'email', 'role', 'isActive', 'isValidated'];
    const updateData = {};

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return this.findById(id);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: this._getUserSelect(false),
    });

    return user;
  }

  /**
   * Update user password
   * @param {number} id - User ID
   * @param {string} newPassword - New password (plain text)
   * @returns {Promise<boolean>}
   */
  async updatePassword(id, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, config.bcrypt.rounds);

    await prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    return true;
  }

  /**
   * Update last login timestamp
   * @param {number} id - User ID
   * @returns {Promise<void>}
   */
  async updateLastLogin(id) {
    await prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  /**
   * Verify user password
   * @param {string} password - Plain text password
   * @param {string} hash - Stored password hash
   * @returns {Promise<boolean>}
   */
  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Delete user by ID
   * @param {number} id - User ID
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    try {
      await prisma.user.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      if (error.code === 'P2025') {
        // Record not found
        return false;
      }
      throw error;
    }
  }

  /**
   * Get all users with pagination and filtering
   * @param {Object} options - Query options
   * @returns {Promise<{users: Array, total: number}>}
   */
  async findAll(options = {}) {
    const {
      page = 1,
      limit = 20,
      role,
      isActive,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = options;

    const where = {};

    if (role) {
      where.role = role;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: this._getUserSelect(false),
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get user statistics (exam count, average score, etc.)
   * @param {number} id - User ID
   * @returns {Promise<Object>}
   */
  async getStats(id) {
    const stats = await prisma.exam.aggregate({
      where: {
        userId: id,
        status: 'completed',
      },
      _count: true,
      _avg: {
        score: true,
      },
    });

    const passedCount = await prisma.exam.count({
      where: {
        userId: id,
        status: 'completed',
        passed: true,
      },
    });

    return {
      totalExams: stats._count,
      averageScore: stats._avg.score ? Number(stats._avg.score.toFixed(2)) : 0,
      passedExams: passedCount,
      passRate: stats._count > 0 
        ? Number(((passedCount / stats._count) * 100).toFixed(2)) 
        : 0,
    };
  }

  /**
   * Check if email exists (for registration validation)
   * @param {string} email - Email to check
   * @param {number} excludeId - User ID to exclude (for updates)
   * @returns {Promise<boolean>}
   */
  async emailExists(email, excludeId = null) {
    const where = {
      email: { equals: email, mode: 'insensitive' },
    };

    if (excludeId) {
      where.NOT = { id: excludeId };
    }

    const count = await prisma.user.count({ where });
    return count > 0;
  }

  /**
   * Check if username exists
   * @param {string} username - Username to check
   * @param {number} excludeId - User ID to exclude (for updates)
   * @returns {Promise<boolean>}
   */
  async usernameExists(username, excludeId = null) {
    const where = {
      username: { equals: username, mode: 'insensitive' },
    };

    if (excludeId) {
      where.NOT = { id: excludeId };
    }

    const count = await prisma.user.count({ where });
    return count > 0;
  }

  /**
   * Get select fields for user queries
   * @param {boolean} includePassword - Include password hash
   * @returns {Object}
   */
  _getUserSelect(includePassword) {
    return {
      id: true,
      username: true,
      email: true,
      passwordHash: includePassword,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      isValidated: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    };
  }
}

module.exports = new UserRepository();
