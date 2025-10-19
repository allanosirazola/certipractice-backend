const User = require('../models/User');
const db = require('../utils/database');
const logger = require('../utils/logger');

class UserService {
  async createUser(userData) {
    try {
      // Validate user data
      const errors = User.validate(userData);
      if (errors.length > 0) {
        throw new Error(errors.join(', '));
      }

      // Check if user already exists
      const existingUserByEmail = await User.findByEmail(userData.email);
      if (existingUserByEmail) {
        throw new Error('User with this email already exists');
      }

      const existingUserByUsername = await User.findByUsername(userData.username);
      if (existingUserByUsername) {
        throw new Error('User with this username already exists');
      }

      // Create new user instance
      const user = new User({
        username: userData.username,
        email: userData.email.toLowerCase(),
        password: userData.password,
        first_name: userData.firstName || '',
        last_name: userData.lastName || '',
        role: userData.role || 'student',
        is_active: userData.isActive !== undefined ? userData.isActive : true,
        is_validated: userData.isValidated !== undefined ? userData.isValidated : false
      });

      // Hash password
      await user.hashPassword();

      // Save to database
      await user.save();

      logger.info(`User created successfully: ${user.username} (${user.email})`);
      return user;
    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  async getUserById(id) {
    try {
      if (!id) {
        return null;
      }
      
      return await User.findById(id);
    } catch (error) {
      logger.error('Error getting user by ID:', error);
      throw error;
    }
  }

  async getUserByEmail(email) {
    try {
      if (!email) {
        return null;
      }
      
      return await User.findByEmail(email.toLowerCase());
    } catch (error) {
      logger.error('Error getting user by email:', error);
      throw error;
    }
  }

  async getUserByUsername(username) {
    try {
      if (!username) {
        return null;
      }
      
      return await User.findByUsername(username);
    } catch (error) {
      logger.error('Error getting user by username:', error);
      throw error;
    }
  }

  async updateUser(id, updateData) {
    try {
      const user = await User.findById(id);
      if (!user) {
        throw new Error('User not found');
      }

      // Update user properties
      if (updateData.username !== undefined) {
        // Check if username is already taken by another user
        const existingUser = await User.findByUsername(updateData.username);
        if (existingUser && existingUser.id !== id) {
          throw new Error('Username already exists');
        }
        user.username = updateData.username;
      }

      if (updateData.email !== undefined) {
        // Check if email is already taken by another user
        const existingUser = await User.findByEmail(updateData.email);
        if (existingUser && existingUser.id !== id) {
          throw new Error('Email already exists');
        }
        user.email = updateData.email.toLowerCase();
      }

      if (updateData.firstName !== undefined) {
        user.first_name = updateData.firstName;
      }

      if (updateData.lastName !== undefined) {
        user.last_name = updateData.lastName;
      }

      if (updateData.role !== undefined) {
        user.role = updateData.role;
      }

      if (updateData.isActive !== undefined) {
        user.is_active = updateData.isActive;
      }

      if (updateData.isValidated !== undefined) {
        user.is_validated = updateData.isValidated;
      }

      if (updateData.lastLogin !== undefined) {
        user.last_login = updateData.lastLogin;
      }

      // If password is being updated
      if (updateData.password) {
        user.password = updateData.password;
        await user.hashPassword();
      }

      // Save updated user
      await user.save();

      logger.info(`User updated successfully: ${user.username} (${user.email})`);
      return user;
    } catch (error) {
      logger.error('Error updating user:', error);
      throw error;
    }
  }

  async deleteUser(id) {
    try {
      const user = await User.findById(id);
      if (!user) {
        throw new Error('User not found');
      }

      await user.delete();

      logger.info(`User deleted successfully: ${user.username} (${user.email})`);
      return true;
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw error;
    }
  }

  async getUserStats(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      return await user.getStats();
    } catch (error) {
      logger.error('Error getting user stats:', error);
      throw error;
    }
  }

  async updateUserLastLogin(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      await user.updateLastLogin();
      return user;
    } catch (error) {
      logger.error('Error updating user last login:', error);
      throw error;
    }
  }

  async updateUserStats(userId, examResult) {
    try {
      // This method would be called after exam completion
      // For now, we'll just update some basic tracking
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // The stats are now calculated dynamically from the database
      // so we don't need to update them manually anymore
      // This method exists for compatibility but stats are computed in real-time

      logger.info(`User stats updated for user: ${user.username}`);
      return user;
    } catch (error) {
      logger.error('Error updating user stats:', error);
      throw error;
    }
  }

  async getAllUsers(options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        sortBy = 'created_at',
        sortOrder = 'DESC',
        role = null,
        isActive = null,
        search = null
      } = options;

      const offset = (page - 1) * limit;
      
      let whereConditions = [];
      let queryParams = [];
      let paramIndex = 1;

      if (role) {
        whereConditions.push(`role = $${paramIndex}`);
        queryParams.push(role);
        paramIndex++;
      }

      if (isActive !== null) {
        whereConditions.push(`is_active = $${paramIndex}`);
        queryParams.push(isActive);
        paramIndex++;
      }

      if (search) {
        whereConditions.push(`(username ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex})`);
        queryParams.push(`%${search}%`);
        paramIndex++;
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // Count total users
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM users 
        ${whereClause}
      `;
      const countResult = await db.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total);

      // Get users
      const usersQuery = `
        SELECT * FROM users 
        ${whereClause}
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      queryParams.push(limit, offset);

      const usersResult = await db.query(usersQuery, queryParams);
      const users = usersResult.rows.map(userData => new User(userData));

      return {
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error getting all users:', error);
      throw error;
    }
  }

  async getUserProgress(userId, certificationId = null) {
    try {
      let query = `
        SELECT 
          up.*,
          c.name as certification_name,
          t.name as topic_name
        FROM user_progress up
        LEFT JOIN certifications c ON up.certification_id = c.id
        LEFT JOIN topics t ON up.topic_id = t.id
        WHERE up.user_id = $1
      `;
      const params = [userId];

      if (certificationId) {
        query += ` AND up.certification_id = $2`;
        params.push(certificationId);
      }

      query += ` ORDER BY up.last_activity DESC`;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error getting user progress:', error);
      throw error;
    }
  }

  async validateUser(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      user.is_validated = true;
      await user.save();

      logger.info(`User validated successfully: ${user.username} (${user.email})`);
      return user;
    } catch (error) {
      logger.error('Error validating user:', error);
      throw error;
    }
  }

  async deactivateUser(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      user.is_active = false;
      await user.save();

      logger.info(`User deactivated successfully: ${user.username} (${user.email})`);
      return user;
    } catch (error) {
      logger.error('Error deactivating user:', error);
      throw error;
    }
  }

  async activateUser(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      user.is_active = true;
      await user.save();

      logger.info(`User activated successfully: ${user.username} (${user.email})`);
      return user;
    } catch (error) {
      logger.error('Error activating user:', error);
      throw error;
    }
  }

  async changeUserRole(userId, newRole) {
    try {
      const validRoles = ['student', 'instructor', 'admin'];
      if (!validRoles.includes(newRole)) {
        throw new Error('Invalid role');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      user.role = newRole;
      await user.save();

      logger.info(`User role changed successfully: ${user.username} (${user.email}) - New role: ${newRole}`);
      return user;
    } catch (error) {
      logger.error('Error changing user role:', error);
      throw error;
    }
  }

  async getUsersByRole(role) {
    try {
      const query = `
        SELECT * FROM users 
        WHERE role = $1 AND is_active = true
        ORDER BY created_at DESC
      `;
      
      const result = await db.query(query, [role]);
      return result.rows.map(userData => new User(userData));
    } catch (error) {
      logger.error('Error getting users by role:', error);
      throw error;
    }
  }

  async getUserBookmarks(userId) {
    try {
      const query = `
        SELECT 
          b.*,
          q.question_text,
          q.difficulty_level,
          t.name as topic_name,
          c.name as certification_name
        FROM bookmarks b
        JOIN questions q ON b.question_id = q.id
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        WHERE b.user_id = $1
        ORDER BY b.created_at DESC
      `;
      
      const result = await db.query(query, [userId]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting user bookmarks:', error);
      throw error;
    }
  }

  async getUserErrorResponses(userId, limit = 20) {
    try {
      const query = `
        SELECT 
          er.*,
          q.question_text,
          q.difficulty_level,
          t.name as topic_name,
          c.name as certification_name
        FROM error_responses er
        JOIN questions q ON er.question_id = q.id
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        WHERE er.user_id = $1
        ORDER BY er.last_error_date DESC, er.error_count DESC
        LIMIT $2
      `;
      
      const result = await db.query(query, [userId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting user error responses:', error);
      throw error;
    }
  }

  async resetUserPassword(userId, newPassword) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Validate new password
      const errors = User.validate({ password: newPassword });
      if (errors.length > 0) {
        throw new Error(errors.join(', '));
      }

      user.password = newPassword;
      await user.hashPassword();
      await user.save();

      logger.info(`Password reset successfully for user: ${user.username} (${user.email})`);
      return user;
    } catch (error) {
      logger.error('Error resetting user password:', error);
      throw error;
    }
  }

  async getUserActivity(userId, limit = 50) {
    try {
      const query = `
        SELECT 
          'exam' as activity_type,
          e.id as activity_id,
          e.status,
          e.score,
          e.percentage_score,
          e.passing_status,
          e.created_at,
          e.completed_at,
          c.name as certification_name
        FROM exams e
        JOIN certifications c ON e.certification_id = c.id
        WHERE e.user_id = $1
        
        UNION ALL
        
        SELECT 
          'bookmark' as activity_type,
          b.id as activity_id,
          'bookmarked' as status,
          NULL as score,
          NULL as percentage_score,
          NULL as passing_status,
          b.created_at,
          b.created_at as completed_at,
          c.name as certification_name
        FROM bookmarks b
        JOIN questions q ON b.question_id = q.id
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        WHERE b.user_id = $1
        
        ORDER BY created_at DESC
        LIMIT $2
      `;
      
      const result = await db.query(query, [userId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting user activity:', error);
      throw error;
    }
  }
}

module.exports = new UserService();