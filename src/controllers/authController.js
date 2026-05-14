const UserService = require('../services/userService');
const User = require('../models/User');
const logger = require('../utils/logger');
const config = require('../config/config');
const telemetry = require('../services/telemetryService');
const emailService = require('../services/emailService');
const pool = require('../database/pool');

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

    // Generate a verification token and persist it on the user row.
    // 24h expiry — matches what most email providers expect.
    const verificationToken = emailService.generateVerificationToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      await pool.query(
        `UPDATE users
            SET email_verified              = FALSE,
                email_verification_token    = $1,
                email_verification_expires  = $2
          WHERE id = $3`,
        [verificationToken, expiresAt, user.id]
      );
    } catch (err) {
      // Don't fail the registration if updating the token fails —
      // the user can request another via /resend-verification.
      logger.warn('Failed to persist verification token:', err?.message);
    }

    // Detect preferred language from Accept-Language header (best-effort)
    const langHeader = String(req.headers?.['accept-language'] || '').toLowerCase();
    const lang = langHeader.startsWith('en') ? 'en' : 'es';

    // Fire-and-forget — don't block the API response on the email transport
    emailService.sendVerificationEmail({
      to: user.email,
      username: user.username,
      token: verificationToken,
      req,
      lang,
    }).catch((err) => logger.warn('sendVerificationEmail rejected:', err?.message));

    const token = user.generateToken();

    logger.info(`User registered: ${user.username} (${user.email}) — verification pending`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Check your email to verify your account.',
      data: {
        user: { ...user.toJSON(), emailVerified: false },
        token,
        emailVerificationRequired: true,
      }
    });

    // Telemetry: track registration
    telemetry.trackUserActivity({
      activityType: 'registration',
      req,
      userId: user.id,
      metadata: { username: user.username, email: user.email },
    }).catch(() => {});
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

    // Telemetry: track login (fire-and-forget)
    telemetry.trackUserActivity({
      activityType: 'login',
      req,
      userId: user.id,
      metadata: { username: user.username },
    }).catch(() => {});
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

    // Telemetry: track logout
    if (req.user) {
      telemetry.trackUserActivity({
        activityType: 'logout',
        req,
      }).catch(() => {});
    }
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
};

const verifyToken = async (req, res) => {
  try {
    // Token is already verified by auth middleware
    // Get fresh user data
    const user = await UserService.getUserById(req.user.id);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    res.json({
      success: true,
      data: {
        valid: true,
        user: user.toJSON()
      }
    });
  } catch (error) {
    logger.error('Verify token error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid token'
    });
  }
};

/**
 * POST /api/auth/verify-email
 *
 * Body: { token: string }
 *
 * Checks the token against the user row, ensures it hasn't expired, and
 * flips email_verified=true. Returns generic 400 for any failure mode
 * (invalid/expired/used) so we don't leak whether a token existed.
 */
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Token is required'
      });
    }

    const result = await pool.query(
      `SELECT id, email, username, email_verified, email_verification_expires
         FROM users
        WHERE email_verification_token = $1
        LIMIT 1`,
      [token]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification link'
      });
    }
    if (row.email_verified) {
      // Idempotent: clicking the link twice should not error
      return res.json({
        success: true,
        message: 'Email already verified',
        data: { alreadyVerified: true }
      });
    }
    if (row.email_verification_expires && new Date(row.email_verification_expires) < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Verification link has expired. Request a new one.',
        code: 'TOKEN_EXPIRED'
      });
    }

    await pool.query(
      `UPDATE users
          SET email_verified              = TRUE,
              email_verification_token    = NULL,
              email_verification_expires  = NULL,
              updated_at                  = NOW()
        WHERE id = $1`,
      [row.id]
    );

    logger.info(`Email verified: ${row.username} (${row.email})`);
    telemetry.trackUserActivity({
      activityType: 'feature_used',
      req,
      userId: row.id,
      metadata: { feature: 'email_verified' },
    }).catch(() => {});

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: { verified: true }
    });
  } catch (error) {
    logger.error('verifyEmail error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

/**
 * POST /api/auth/resend-verification
 *
 * Body: { email?: string }   ← when called anonymously
 *  …or the authenticated user implicitly (req.user.id)
 *
 * Issues a new token and re-sends the verification email. To prevent
 * enumeration we always return success regardless of whether the address
 * exists in the database.
 */
const resendVerification = async (req, res) => {
  try {
    // Prefer the authenticated user's email; fall back to the body for
    // the case where someone is unauthenticated but knows their address.
    const targetEmail = (req.user?.email
      || req.body?.email
      || '').toString().trim().toLowerCase();

    if (!targetEmail) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const lookup = await pool.query(
      `SELECT id, email, username, email_verified FROM users WHERE email = $1 LIMIT 1`,
      [targetEmail]
    );
    const user = lookup.rows[0];

    // Always return 200 to avoid leaking which emails exist
    if (!user || user.email_verified) {
      logger.info(`resendVerification — no-op for ${targetEmail} (missing or already verified)`);
      return res.json({
        success: true,
        message: 'If an account exists with that email, a verification link has been sent.'
      });
    }

    const verificationToken = emailService.generateVerificationToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      `UPDATE users
          SET email_verification_token   = $1,
              email_verification_expires = $2,
              updated_at                 = NOW()
        WHERE id = $3`,
      [verificationToken, expiresAt, user.id]
    );

    const langHeader = String(req.headers?.['accept-language'] || '').toLowerCase();
    const lang = langHeader.startsWith('en') ? 'en' : 'es';

    emailService.sendVerificationEmail({
      to: user.email,
      username: user.username,
      token: verificationToken,
      req,
      lang,
    }).catch((err) => logger.warn('resend sendVerificationEmail rejected:', err?.message));

    res.json({
      success: true,
      message: 'If an account exists with that email, a verification link has been sent.'
    });
  } catch (error) {
    logger.error('resendVerification error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
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
  logout,
  verifyToken,
  verifyEmail,
  resendVerification
};