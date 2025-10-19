const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const db = require('../utils/database');
const logger = require('../utils/logger');

class User {
  constructor(userData = {}) {
    this.id = userData.id || null;
    this.username = userData.username || '';
    this.email = userData.email || '';
    this.password_hash = userData.password_hash || '';
    this.first_name = userData.first_name || '';
    this.last_name = userData.last_name || '';
    this.role = userData.role || 'student';
    this.is_active = userData.is_active !== undefined ? userData.is_active : true;
    this.is_validated = userData.is_validated !== undefined ? userData.is_validated : false;
    this.last_login = userData.last_login || null;
    this.created_at = userData.created_at || null;
    this.updated_at = userData.updated_at || null;
  }

  static validate(userData) {
    const errors = [];
    
    // Username validation
    if (!userData.username || userData.username.length < 3) {
      errors.push('Username must be at least 3 characters long');
    }
    
    if (userData.username && !/^[a-zA-Z0-9_]+$/.test(userData.username)) {
      errors.push('Username can only contain letters, numbers, and underscores');
    }
    
    // Email validation
    if (!userData.email) {
      errors.push('Email is required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) {
      errors.push('Please provide a valid email address');
    }
    
    // Password validation
    if (!userData.password) {
      errors.push('Password is required');
    } else if (userData.password.length < config.security.passwordMinLength) {
      errors.push(`Password must be at least ${config.security.passwordMinLength} characters long`);
    }
    
    if (config.security.requireStrongPasswords && userData.password) {
      const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
      if (!strongPasswordRegex.test(userData.password)) {
        errors.push('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character');
      }
    }
    
    return errors;
  }

  async hashPassword() {
    if (this.password) {
      this.password_hash = await bcrypt.hash(this.password, config.bcryptRounds);
      delete this.password; // Remove plain password
    }
  }

  async comparePassword(password) {
    return bcrypt.compare(password, this.password_hash);
  }

  generateToken() {
    return jwt.sign(
      { 
        id: this.id,
        email: this.email,
        role: this.role
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpire }
    );
  }

  toJSON() {
    const userObj = {
      id: this.id,
      username: this.username,
      email: this.email,
      firstName: this.first_name,
      lastName: this.last_name,
      role: this.role,
      isActive: this.is_active,
      isValidated: this.is_validated,
      lastLogin: this.last_login,
      createdAt: this.created_at,
      updatedAt: this.updated_at
    };

    // Remove password-related fields from JSON output
    delete userObj.password_hash;
    delete userObj.password;
    
    return userObj;
  }

  get isAdmin() {
    return this.role === 'admin';
  }

  get isInstructor() {
    return ['admin', 'instructor'].includes(this.role);
  }

  get isStudent() {
    return this.role === 'student';
  }

  // Static methods for database operations
  static async findById(id) {
    try {
      const query = `
        SELECT * FROM users 
        WHERE id = $1 AND is_active = true
      `;
      const result = await db.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error finding user by ID:', error);
      throw new Error('Database error');
    }
  }

  static async findByEmail(email) {
    try {
      const query = `
        SELECT * FROM users 
        WHERE email = $1
      `;
      const result = await db.query(query, [email]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error finding user by email:', error);
      throw new Error('Database error');
    }
  }

  static async findByUsername(username) {
    try {
      const query = `
        SELECT * FROM users 
        WHERE username = $1
      `;
      const result = await db.query(query, [username]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error finding user by username:', error);
      throw new Error('Database error');
    }
  }

  async save() {
    try {
      if (this.id) {
        // Update existing user
        const query = `
          UPDATE users 
          SET username = $1, email = $2, password_hash = $3, 
              first_name = $4, last_name = $5, role = $6, 
              is_active = $7, is_validated = $8, last_login = $9,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $10
          RETURNING *
        `;
        const values = [
          this.username, this.email, this.password_hash,
          this.first_name, this.last_name, this.role,
          this.is_active, this.is_validated, this.last_login,
          this.id
        ];
        
        const result = await db.query(query, values);
        const userData = result.rows[0];
        
        // Update instance with returned data
        Object.assign(this, userData);
        
        return this;
      } else {
        // Create new user
        const query = `
          INSERT INTO users (username, email, password_hash, first_name, last_name, role, is_active, is_validated)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        const values = [
          this.username, this.email, this.password_hash,
          this.first_name, this.last_name, this.role,
          this.is_active, this.is_validated
        ];
        
        const result = await db.query(query, values);
        const userData = result.rows[0];
        
        // Update instance with returned data
        Object.assign(this, userData);
        
        return this;
      }
    } catch (error) {
      logger.error('Error saving user:', error);
      
      // Handle specific PostgreSQL errors
      if (error.code === '23505') {
        if (error.constraint === 'users_email_key') {
          throw new Error('Email already exists');
        } else if (error.constraint === 'users_username_key') {
          throw new Error('Username already exists');
        }
      }
      
      throw new Error('Database error');
    }
  }

  async delete() {
    try {
      if (!this.id) {
        throw new Error('Cannot delete user without ID');
      }

      // Soft delete by setting is_active to false
      const query = `
        UPDATE users 
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `;
      
      const result = await db.query(query, [this.id]);
      
      if (result.rows.length === 0) {
        throw new Error('User not found');
      }
      
      this.is_active = false;
      this.updated_at = result.rows[0].updated_at;
      
      return this;
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw new Error('Database error');
    }
  }

  // Get user statistics
  async getStats() {
    try {
      const query = `
        SELECT 
          COUNT(DISTINCT e.id) as total_exams,
          COUNT(DISTINCT CASE WHEN e.passing_status = 'passed' THEN e.id END) as passed_exams,
          COALESCE(AVG(e.percentage_score), 0) as average_score,
          COALESCE(SUM(e.total_questions), 0) as total_questions,
          COALESCE(SUM(e.correct_answers), 0) as correct_answers,
          COALESCE(SUM(e.time_spent_minutes), 0) as total_time_minutes
        FROM users u
        LEFT JOIN exams e ON u.id = e.user_id AND e.status = 'completed'
        WHERE u.id = $1
        GROUP BY u.id
      `;
      
      const result = await db.query(query, [this.id]);
      
      if (result.rows.length === 0) {
        return {
          totalExams: 0,
          passedExams: 0,
          averageScore: 0,
          totalQuestions: 0,
          correctAnswers: 0,
          totalTimeMinutes: 0,
          successRate: 0
        };
      }
      
      const stats = result.rows[0];
      return {
        totalExams: parseInt(stats.total_exams) || 0,
        passedExams: parseInt(stats.passed_exams) || 0,
        averageScore: Math.round(parseFloat(stats.average_score) || 0),
        totalQuestions: parseInt(stats.total_questions) || 0,
        correctAnswers: parseInt(stats.correct_answers) || 0,
        totalTimeMinutes: parseInt(stats.total_time_minutes) || 0,
        successRate: stats.total_questions > 0 
          ? Math.round((stats.correct_answers / stats.total_questions) * 100) 
          : 0
      };
    } catch (error) {
      logger.error('Error getting user stats:', error);
      throw new Error('Database error');
    }
  }

  // Update last login
  async updateLastLogin() {
    try {
      const query = `
        UPDATE users 
        SET last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING last_login
      `;
      
      const result = await db.query(query, [this.id]);
      
      if (result.rows.length > 0) {
        this.last_login = result.rows[0].last_login;
      }
      
      return this;
    } catch (error) {
      logger.error('Error updating last login:', error);
      throw new Error('Database error');
    }
  }
}

module.exports = User;