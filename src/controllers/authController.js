const UserService = require('../services/userService');
const User = require('../models/User');
const logger = require('../utils/logger');
const config = require('../config/config');

const register = async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, role } = req.body;

    // Validate required fields
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username, email, and password are required'
      });
    }

    // Validate input using User model
    const errors = User.validate({ username, email, password });
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: errors.join(', ')
      });
    }

    // Only admins can set roles other than 'student'
    let userRole = 'student';
    if (role && ['instructor', 'admin'].includes(role)) {
      // Check if the request is from an authenticated admin
      if (req.user && req.user.role === 'admin') {
        userRole = role;
      } else {
        return res.status(403).json({
          success: false,
          error: 'Only administrators can assign instructor or admin roles'
        });
      }
    }

    const user = await UserService.createUser({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password,
      firstName: firstName?.trim() || '',
      lastName: lastName?.trim() || '',
      role: userRole
    });

    const token = user.generateToken();

    // Log successful registration
    logger.info(`User registered successfully: ${user.username} (${user.email})`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: user.toJSON(),
        token
      }
    });
  } catch (error) {
    logger.error('Registration error:', error);
    
    // Handle specific errors
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        error: error.message
      });
    }

    res.status(400).json({
      success: false,
      error: error.message || 'Registration failed'
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password, username } = req.body;

    // Allow login with either email or username
    if ((!email && !username) || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email/username and password are required'
      });
    }

    // Find user by email or username
    let user;
    if (email) {
      user = await UserService.getUserByEmail(email.trim().toLowerCase());
    } else if (username) {
      user = await UserService.getUserByUsername(username.trim());
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated. Please contact support.'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Check if email verification is required
    if (config.security.requireEmailVerification && !user.is_validated) {
      return res.status(403).json({
        success: false,
        error: 'Email verification required. Please check your email.',
        requiresVerification: true
      });
    }

    // Update last login
    await user.updateLastLogin();

    const token = user.generateToken();

    // Log successful login
    logger.info(`User logged in successfully: ${user.username} (${user.email})`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toJSON(),
        token
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed. Please try again.'
    });
  }
};

const getProfile = async (req, res) => {
  try {
    // Get fresh user data from database
    const user = await UserService.getUserById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Get user stats
    const stats = await user.getStats();

    res.json({
      success: true,
      data: {
        ...user.toJSON(),
        stats
      }
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user profile'
    });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, username, email, currentPassword, newPassword } = req.body;
    
    const updates = {};
    
    // Basic profile updates
    if (firstName !== undefined) updates.firstName = firstName.trim();
    if (lastName !== undefined) updates.lastName = lastName.trim();
    
    // Username and email updates require verification
    if (username !== undefined) {
      if (username.trim() !== req.user.username) {
        updates.username = username.trim();
      }
    }
    
    if (email !== undefined) {
      if (email.trim().toLowerCase() !== req.user.email) {
        updates.email = email.trim().toLowerCase();
        // If email verification is required, mark as unvalidated
        if (config.security.requireEmailVerification) {
          updates.isValidated = false;
        }
      }
    }

    // Password update requires current password verification
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          error: 'Current password is required to set a new password'
        });
      }

      // Get current user and verify password
      const currentUser = await UserService.getUserById(req.user.id);
      const isCurrentPasswordValid = await currentUser.comparePassword(currentPassword);
      
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          error: 'Current password is incorrect'
        });
      }

      // Validate new password
      const passwordErrors = User.validate({ password: newPassword });
      if (passwordErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: passwordErrors.join(', ')
        });
      }

      updates.password = newPassword;
    }

    // Validate username and email if they're being updated
    if (updates.username || updates.email) {
      const errors = User.validate({
        username: updates.username || req.user.username,
        email: updates.email || req.user.email,
        password: 'dummy-for-validation' // Not actually used for updates
      });
      
      const relevantErrors = errors.filter(error => 
        (updates.username && error.includes('Username')) ||
        (updates.email && error.includes('Email'))
      );
      
      if (relevantErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: relevantErrors.join(', ')
        });
      }
    }

    const updatedUser = await UserService.updateUser(req.user.id, updates);

    logger.info(`Profile updated successfully for user: ${updatedUser.username} (${updatedUser.email})`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedUser.toJSON()
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    
    // Handle specific errors
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update profile'
    });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    // Get current user and verify password
    const currentUser = await UserService.getUserById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const isCurrentPasswordValid = await currentUser.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Validate new password
    const errors = User.validate({ password: newPassword });
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: errors.join(', ')
      });
    }

    await UserService.updateUser(req.user.id, { password: newPassword });

    logger.info(`Password changed successfully for user: ${currentUser.username} (${currentUser.email})`);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password confirmation is required'
      });
    }

    // Get current user and verify password
    const currentUser = await UserService.getUserById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const isPasswordValid = await currentUser.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Password is incorrect'
      });
    }

    // Soft delete the user (deactivate)
    await UserService.deleteUser(req.user.id);

    logger.info(`Account deleted for user: ${currentUser.username} (${currentUser.email})`);

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    logger.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account'
    });
  }
};

const refreshToken = async (req, res) => {
  try {
    // Get fresh user data
    const user = await UserService.getUserById(req.user.id);
    
    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'User not found or inactive'
      });
    }

    const newToken = user.generateToken();

    res.json({
      success: true,
      data: {
        token: newToken,
        user: user.toJSON()
      }
    });
  } catch (error) {
    logger.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh token'
    });
  }
};

const validateEmail = async (req, res) => {
  try {
    const { token } = req.params;
    
    // In a real implementation, you would verify the email validation token
    // For now, we'll just validate the current user
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const user = await UserService.validateUser(req.user.id);

    res.json({
      success: true,
      message: 'Email validated successfully',
      data: user.toJSON()
    });
  } catch (error) {
    logger.error('Email validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate email'
    });
  }
};

const logout = async (req, res) => {
  try {
    // In a stateless JWT system, logout is typically handled client-side
    // But we can log the event for security monitoring
    if (req.user) {
      logger.info(`User logged out: ${req.user.username || req.user.email}`);
    }

    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  changePassword,
  deleteAccount,
  refreshToken,
  validateEmail,
  logout
};