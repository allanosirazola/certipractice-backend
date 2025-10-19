const UserService = require('../services/userService');
const ExamService = require('../services/examService');
const logger = require('../utils/logger');

const getUserStats = async (req, res) => {
  try {
    const stats = await UserService.getUserStats(req.user.id);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user statistics'
    });
  }
};

const getUserProgress = async (req, res) => {
  try {
    const { certificationId } = req.query;
    const progress = await UserService.getUserProgress(req.user.id, certificationId);
    
    res.json({
      success: true,
      data: progress
    });
  } catch (error) {
    logger.error('Get user progress error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user progress'
    });
  }
};

const getUserBookmarks = async (req, res) => {
  try {
    const bookmarks = await UserService.getUserBookmarks(req.user.id);
    
    res.json({
      success: true,
      data: bookmarks
    });
  } catch (error) {
    logger.error('Get user bookmarks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user bookmarks'
    });
  }
};

const getUserErrorResponses = async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const errorResponses = await UserService.getUserErrorResponses(req.user.id, parseInt(limit));
    
    res.json({
      success: true,
      data: errorResponses
    });
  } catch (error) {
    logger.error('Get user error responses error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user error responses'
    });
  }
};

const getUserActivity = async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const activity = await UserService.getUserActivity(req.user.id, parseInt(limit));
    
    res.json({
      success: true,
      data: activity
    });
  } catch (error) {
    logger.error('Get user activity error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user activity'
    });
  }
};

// NEW: Failed Questions Functions
const getFailedQuestions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { provider, certification, category, difficulty, limit = 50 } = req.query;

    let whereConditions = [
      'e.user_id = $1',
      'ua.is_correct = false',
      'e.status = $2'
    ];
    let queryParams = [userId, 'completed'];
    let paramIndex = 3;

    if (provider) {
      whereConditions.push(`p.name = $${paramIndex}`);
      queryParams.push(provider);
      paramIndex++;
    }

    if (certification) {
      whereConditions.push(`c.id = $${paramIndex}`);
      queryParams.push(certification);
      paramIndex++;
    }

    if (category) {
      whereConditions.push(`t.name = $${paramIndex}`);
      queryParams.push(category);
      paramIndex++;
    }

    if (difficulty) {
      whereConditions.push(`q.difficulty_level = $${paramIndex}`);
      queryParams.push(difficulty);
      paramIndex++;
    }

    const query = `
      SELECT DISTINCT
        q.id,
        q.question_text as text,
        q.difficulty_level as difficulty,
        q.explanation,
        t.name as category,
        c.name as certification_name,
        p.name as provider_name,
        COUNT(ua.id) as failed_count,
        MAX(ua.answered_at) as last_failed_at,
        MIN(ua.answered_at) as first_failed_at
      FROM user_answers ua
      JOIN exam_questions eq ON ua.exam_question_id = eq.id
      JOIN questions q ON eq.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON eq.exam_id = e.id
      WHERE ${whereConditions.join(' AND ')}
        AND q.is_active = true
      GROUP BY q.id, q.question_text, q.difficulty_level, q.explanation, 
               t.name, c.name, p.name
      ORDER BY failed_count DESC, last_failed_at DESC
      LIMIT $${paramIndex}
    `;

    queryParams.push(parseInt(limit));
    const result = await ExamService.pool.query(query, queryParams);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Get failed questions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get failed questions'
    });
  }
};

const getFailedQuestionsStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { provider, certification } = req.query;
    console.log(provider)
    console.log(certification)
    let whereConditions = [
      'e.user_id = $1',
      'ua.is_correct = false',
      'e.status = $2'
    ];
    let queryParams = [userId, 'completed'];
    let paramIndex = 3;

    if (provider) {
      whereConditions.push(`p.name = $${paramIndex}`);
      queryParams.push(provider);
      paramIndex++;
    }

    if (certification) {
      whereConditions.push(`c.id = $${paramIndex}`);
      queryParams.push(certification);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    const totalQuery = `
      SELECT COUNT(DISTINCT q.id) as total_failed_questions
      FROM user_answers ua
      JOIN exam_questions eq ON ua.exam_question_id = eq.id
      JOIN questions q ON eq.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON eq.exam_id = e.id
      WHERE ${whereClause} AND q.is_active = true
    `;

    const categoryQuery = `
      SELECT 
        t.name as category,
        COUNT(DISTINCT q.id) as failed_questions,
        COUNT(ua.id) as total_failures
      FROM user_answers ua
      JOIN exam_questions eq ON ua.exam_question_id = eq.id
      JOIN questions q ON eq.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON eq.exam_id = e.id
      WHERE ${whereClause} AND q.is_active = true
      GROUP BY t.name
      ORDER BY failed_questions DESC
    `;

    const difficultyQuery = `
      SELECT 
        q.difficulty_level as difficulty,
        COUNT(DISTINCT q.id) as failed_questions,
        COUNT(ua.id) as total_failures
      FROM user_answers ua
      JOIN exam_questions eq ON ua.exam_question_id = eq.id
      JOIN questions q ON eq.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON eq.exam_id = e.id
      WHERE ${whereClause} AND q.is_active = true
      GROUP BY q.difficulty_level
      ORDER BY 
        CASE q.difficulty_level 
          WHEN 'easy' THEN 1 
          WHEN 'medium' THEN 2 
          WHEN 'hard' THEN 3 
          WHEN 'expert' THEN 4 
        END
    `;

    const topFailedQuery = `
      SELECT 
        q.id,
        LEFT(q.question_text, 100) || CASE WHEN LENGTH(q.question_text) > 100 THEN '...' ELSE '' END as text,
        q.difficulty_level as difficulty,
        t.name as category,
        COUNT(ua.id) as failed_count
      FROM user_answers ua
      JOIN exam_questions eq ON ua.exam_question_id = eq.id
      JOIN questions q ON eq.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON eq.exam_id = e.id
      WHERE ${whereClause} AND q.is_active = true
      GROUP BY q.id, q.question_text, q.difficulty_level, t.name
      ORDER BY failed_count DESC
      LIMIT 10
    `;

    const [totalResult, categoryResult, difficultyResult, topFailedResult] = await Promise.all([
      ExamService.pool.query(totalQuery, queryParams),
      ExamService.pool.query(categoryQuery, queryParams),
      ExamService.pool.query(difficultyQuery, queryParams),
      ExamService.pool.query(topFailedQuery, queryParams)
    ]);

    const stats = {
      totalFailedQuestions: parseInt(totalResult.rows[0]?.total_failed_questions || 0),
      byCategory: categoryResult.rows,
      byDifficulty: difficultyResult.rows,
      topFailed: topFailedResult.rows,
      hasEnoughForExam: parseInt(totalResult.rows[0]?.total_failed_questions || 0) >= 5,
      minQuestionsForExam: 5
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Get failed questions stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get failed questions statistics'
    });
  }
};

// Admin endpoints
const getAllUsers = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    const {
      page = 1,
      limit = 10,
      sortBy = 'created_at',
      sortOrder = 'DESC',
      role,
      isActive,
      search
    } = req.query;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sortBy,
      sortOrder: sortOrder.toUpperCase(),
      role,
      isActive: isActive !== undefined ? isActive === 'true' : null,
      search
    };

    const result = await UserService.getAllUsers(options);
    
    res.json({
      success: true,
      data: result.users.map(user => user.toJSON()),
      pagination: result.pagination
    });
  } catch (error) {
    logger.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get users'
    });
  }
};

const getUserById = async (req, res) => {
  try {
    // Check if user is admin or requesting their own data
    if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.id)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const user = await UserService.getUserById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Get user stats if requesting own data or if admin
    let userData = user.toJSON();
    if (req.user.id === parseInt(req.params.id) || req.user.role === 'admin') {
      userData.stats = await user.getStats();
    }
    
    res.json({
      success: true,
      data: userData
    });
  } catch (error) {
    logger.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user'
    });
  }
};

const updateUserRole = async (req, res) => {
  try {
    // Only admins can change roles
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    const { id } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({
        success: false,
        error: 'Role is required'
      });
    }

    const validRoles = ['student', 'instructor', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role. Must be one of: student, instructor, admin'
      });
    }

    // Prevent admin from demoting themselves
    if (parseInt(id) === req.user.id && role !== 'admin') {
      return res.status(400).json({
        success: false,
        error: 'You cannot change your own admin role'
      });
    }

    const updatedUser = await UserService.changeUserRole(id, role);
    
    res.json({
      success: true,
      message: 'User role updated successfully',
      data: updatedUser.toJSON()
    });
  } catch (error) {
    logger.error('Update user role error:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update user role'
    });
  }
};

const activateUser = async (req, res) => {
  try {
    // Only admins can activate/deactivate users
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    const { id } = req.params;

    // Prevent admin from deactivating themselves
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        error: 'You cannot deactivate your own account'
      });
    }

    const updatedUser = await UserService.activateUser(id);
    
    res.json({
      success: true,
      message: 'User activated successfully',
      data: updatedUser.toJSON()
    });
  } catch (error) {
    logger.error('Activate user error:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to activate user'
    });
  }
};

const deactivateUser = async (req, res) => {
  try {
    // Only admins can activate/deactivate users
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    const { id } = req.params;

    // Prevent admin from deactivating themselves
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        error: 'You cannot deactivate your own account'
      });
    }

    const updatedUser = await UserService.deactivateUser(id);
    
    res.json({
      success: true,
      message: 'User deactivated successfully',
      data: updatedUser.toJSON()
    });
  } catch (error) {
    logger.error('Deactivate user error:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to deactivate user'
    });
  }
};

const resetUserPassword = async (req, res) => {
  try {
    // Only admins can reset passwords
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password is required'
      });
    }

    await UserService.resetUserPassword(id, newPassword);
    
    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    logger.error('Reset user password error:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (error.message.includes('Password')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to reset password'
    });
  }
};

const getUsersByRole = async (req, res) => {
  try {
    // Only admins and instructors can get users by role
    if (!['admin', 'instructor'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const { role } = req.params;

    const validRoles = ['student', 'instructor', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role'
      });
    }

    const users = await UserService.getUsersByRole(role);
    
    res.json({
      success: true,
      data: users.map(user => user.toJSON())
    });
  } catch (error) {
    logger.error('Get users by role error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get users by role'
    });
  }
};

module.exports = {
  getUserStats,
  getUserProgress,
  getUserBookmarks,
  getUserErrorResponses,
  getUserActivity,
  getFailedQuestions,
  getFailedQuestionsStats,
  getAllUsers,
  getUserById,
  updateUserRole,
  activateUser,
  deactivateUser,
  resetUserPassword,
  getUsersByRole
};