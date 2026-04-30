/**
 * @fileoverview User Model
 * Represents a user in the system
 */

const bcrypt = require('bcryptjs');

/**
 * User roles
 */
const Role = {
  ADMIN: 'admin',
  INSTRUCTOR: 'instructor',
  STUDENT: 'student',
};

const AllRoles = Object.values(Role);

/**
 * User class
 */
class User {
  /**
   * Create a User instance
   * @param {Object} data - User data
   */
  constructor(data = {}) {
    this.id = data.id || null;
    this.username = data.username || '';
    this.email = data.email || '';
    this.passwordHash = data.password_hash || data.passwordHash || '';
    this.firstName = data.first_name || data.firstName || '';
    this.lastName = data.last_name || data.lastName || '';
    this.role = data.role || Role.STUDENT;
    this.isActive = data.is_active ?? data.isActive ?? true;
    this.isValidated = data.is_validated ?? data.isValidated ?? false;
    this.lastLogin = data.last_login || data.lastLogin || null;
    this.createdAt = data.created_at || data.createdAt || new Date().toISOString();
    this.updatedAt = data.updated_at || data.updatedAt || new Date().toISOString();
  }

  /**
   * User roles enum
   */
  static get Role() {
    return Role;
  }

  /**
   * Roles object for external access
   */
  static get Roles() {
    return Role;
  }

  /**
   * All roles array
   */
  static get AllRoles() {
    return AllRoles;
  }

  /**
   * Check if role is valid
   * @param {string} role - Role to check
   * @returns {boolean}
   */
  static isValidRole(role) {
    return Boolean(role && AllRoles.includes(role));
  }

  /**
   * Validate user registration data
   * @param {Object} data - Registration data
   * @returns {Array} - Array of validation errors
   */
  static validate(data) {
    const errors = [];

    // Username validation
    if (!data.username || typeof data.username !== 'string') {
      errors.push('Username is required');
    } else {
      if (data.username.length < 3) {
        errors.push('Username must be at least 3 characters');
      }
      if (data.username.length > 50) {
        errors.push('Username cannot exceed 50 characters');
      }
      if (!/^[a-zA-Z0-9_]+$/.test(data.username)) {
        errors.push('Username can only contain alphanumeric characters and underscores');
      }
    }

    // Email validation
    if (!data.email || typeof data.email !== 'string') {
      errors.push('Email is required');
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        errors.push('Please provide a valid email address');
      }
      if (data.email.length > 255) {
        errors.push('Email cannot exceed 255 characters');
      }
    }

    // Password validation
    if (!data.password || typeof data.password !== 'string') {
      errors.push('Password is required');
    } else {
      if (data.password.length < 8) {
        errors.push('Password must be at least 8 characters');
      }
      if (data.password.length > 128) {
        errors.push('Password cannot exceed 128 characters');
      }
    }

    // Name validation (optional)
    if (data.firstName && data.firstName.length > 100) {
      errors.push('First name cannot exceed 100 characters');
    }
    if (data.lastName && data.lastName.length > 100) {
      errors.push('Last name cannot exceed 100 characters');
    }

    // Role validation
    if (data.role && !AllRoles.includes(data.role)) {
      errors.push(`Role must be one of: ${AllRoles.join(', ')}`);
    }

    return errors;
  }

  /**
   * Validate login data
   * @param {Object} data - Login data
   * @returns {Array} - Array of validation errors
   */
  static validateLogin(data) {
    const errors = [];

    if (!data.email && !data.username) {
      errors.push('Email or username is required');
    }

    if (!data.password) {
      errors.push('Password is required');
    }

    return errors;
  }

  /**
   * Validate password change data
   * @param {Object} data - Password change data
   * @returns {Array} - Array of validation errors
   */
  static validatePasswordChange(data) {
    const errors = [];

    if (!data.currentPassword) {
      errors.push('Current password is required');
    }

    if (!data.newPassword) {
      errors.push('New password is required');
    } else if (data.newPassword.length < 8) {
      errors.push('New password must be at least 8 characters');
    }

    if (data.currentPassword === data.newPassword) {
      errors.push('New password must be different from current password');
    }

    return errors;
  }

  /**
   * Hash a password
   * @param {string} password - Plain text password
   * @param {number} rounds - Bcrypt rounds
   * @returns {Promise<string>} - Hashed password
   */
  static async hashPassword(password, rounds = 12) {
    return bcrypt.hash(password, rounds);
  }

  /**
   * Compare password with hash
   * @param {string} password - Plain text password
   * @param {string} hash - Password hash
   * @returns {Promise<boolean>} - True if match
   */
  static async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Check if user is admin
   * @returns {boolean}
   */
  get isAdmin() {
    return this.role === Role.ADMIN;
  }

  /**
   * Check if user is instructor (or admin)
   * @returns {boolean}
   */
  get isInstructor() {
    return this.role === Role.INSTRUCTOR || this.role === Role.ADMIN;
  }

  /**
   * Check if user is student
   * @returns {boolean}
   */
  get isStudent() {
    return this.role === Role.STUDENT;
  }

  /**
   * Check if user has any of the given roles
   * @param {...string} roles - Roles to check
   * @returns {boolean}
   */
  hasRole(...roles) {
    return roles.includes(this.role);
  }

  /**
   * Check if user can access resource
   * @param {number} resourceOwnerId - Owner ID of resource
   * @returns {boolean}
   */
  canAccess(resourceOwnerId) {
    return this.isAdmin || this.id === resourceOwnerId;
  }

  /**
   * Check if user can access resource (alias)
   * @param {number} resourceOwnerId - Owner ID of resource
   * @returns {boolean}
   */
  canAccessResource(resourceOwnerId) {
    return this.canAccess(resourceOwnerId);
  }

  /**
   * Get full name
   * @returns {string}
   */
  getFullName() {
    return `${this.firstName} ${this.lastName}`.trim();
  }

  /**
   * Get display name (full name, username, or email)
   * @returns {string}
   */
  getDisplayName() {
    const fullName = this.getFullName();
    return fullName || this.username || this.email || '';
  }

  /**
   * Convert to JSON (safe for API response)
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      username: this.username,
      email: this.email,
      firstName: this.firstName,
      lastName: this.lastName,
      fullName: this.getFullName(),
      role: this.role,
      isAdmin: this.isAdmin,
      isInstructor: this.isInstructor,
      isActive: this.isActive,
      isValidated: this.isValidated,
      lastLogin: this.lastLogin,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Convert to public JSON (limited data for other users)
   * @returns {Object}
   */
  toPublicJSON() {
    return {
      id: this.id,
      username: this.username,
      displayName: this.getDisplayName(),
    };
  }

  /**
   * Convert to database format
   * @returns {Object}
   */
  toDatabase() {
    return {
      username: this.username,
      email: this.email,
      password_hash: this.passwordHash,
      first_name: this.firstName,
      last_name: this.lastName,
      role: this.role,
      is_active: this.isActive,
      is_validated: this.isValidated,
    };
  }
}

module.exports = User;
