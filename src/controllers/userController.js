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
      whereConditions.push(`q.difficulty = $${paramIndex}`);
      queryParams.push(difficulty);
      paramIndex++;
    }

    const query = `
      SELECT DISTINCT
        q.id,
        q.question_text as text,
        q.difficulty as difficulty,
        q.explanation,
        t.name as category,
        c.name as certification_name,
        p.name as provider_name,
        COUNT(ua.id) as failed_count,
        MAX(ua.answered_at) as last_failed_at,
        MIN(ua.answered_at) as first_failed_at
      FROM exam_answers ua
      JOIN questions q ON ua.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON ua.exam_id = e.id
      WHERE ${whereConditions.join(' AND ')}
        AND q.is_active = true
      GROUP BY q.id, q.question_text, q.difficulty, q.explanation, 
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
      FROM exam_answers ua
      JOIN questions q ON ua.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON ua.exam_id = e.id
      WHERE ${whereClause} AND q.is_active = true
    `;

    const categoryQuery = `
      SELECT 
        t.name as category,
        COUNT(DISTINCT q.id) as failed_questions,
        COUNT(ua.id) as total_failures
      FROM exam_answers ua
      JOIN questions q ON ua.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON ua.exam_id = e.id
      WHERE ${whereClause} AND q.is_active = true
      GROUP BY t.name
      ORDER BY failed_questions DESC
    `;

    const difficultyQuery = `
      SELECT 
        q.difficulty as difficulty,
        COUNT(DISTINCT q.id) as failed_questions,
        COUNT(ua.id) as total_failures
      FROM exam_answers ua
      JOIN questions q ON ua.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON ua.exam_id = e.id
      WHERE ${whereClause} AND q.is_active = true
      GROUP BY q.difficulty
      ORDER BY 
        CASE q.difficulty 
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
        q.difficulty as difficulty,
        t.name as category,
        COUNT(ua.id) as failed_count
      FROM exam_answers ua
      JOIN questions q ON ua.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON ua.exam_id = e.id
      WHERE ${whereClause} AND q.is_active = true
      GROUP BY q.id, q.question_text, q.difficulty, t.name
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

// NEW: Get failed questions progress over time
const getFailedQuestionsProgress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { provider, certification, timeframe = 'month' } = req.query;

    let intervalDays;
    switch (timeframe) {
      case 'week': intervalDays = 7; break;
      case 'month': intervalDays = 30; break;
      case 'all': intervalDays = 365; break;
      default: intervalDays = 30;
    }

    let whereConditions = ['e.user_id = $1', 'e.status = $2'];
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

    // Get progress over time
    const progressQuery = `
      SELECT 
        DATE_TRUNC('day', ua.answered_at) as date,
        COUNT(DISTINCT CASE WHEN ua.is_correct = false THEN q.id END) as failed_questions,
        COUNT(DISTINCT CASE WHEN ua.is_correct = true THEN q.id END) as correct_questions,
        COUNT(DISTINCT q.id) as total_questions
      FROM exam_answers ua
      JOIN questions q ON ua.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON ua.exam_id = e.id
      WHERE ${whereClause}
        AND ua.answered_at >= NOW() - INTERVAL '${intervalDays} days'
      GROUP BY DATE_TRUNC('day', ua.answered_at)
      ORDER BY date
    `;

    // Get improvement stats (questions that were failed before but answered correctly recently)
    const improvementQuery = `
      WITH failed_questions AS (
        SELECT DISTINCT q.id as question_id
        FROM exam_answers ua
        JOIN questions q ON ua.question_id = q.id
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        JOIN exams e ON ua.exam_id = e.id
        WHERE ${whereClause} AND ua.is_correct = false
      ),
      recently_correct AS (
        SELECT DISTINCT q.id as question_id
        FROM exam_answers ua
        JOIN questions q ON ua.question_id = q.id
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        JOIN exams e ON ua.exam_id = e.id
        WHERE ${whereClause} 
          AND ua.is_correct = true
          AND ua.answered_at >= NOW() - INTERVAL '${intervalDays} days'
      )
      SELECT 
        (SELECT COUNT(*) FROM failed_questions) as total_failed,
        (SELECT COUNT(*) FROM recently_correct WHERE question_id IN (SELECT question_id FROM failed_questions)) as improved,
        (SELECT COUNT(*) FROM failed_questions WHERE question_id NOT IN (SELECT question_id FROM recently_correct)) as still_struggling
    `;

    const [progressResult, improvementResult] = await Promise.all([
      ExamService.pool.query(progressQuery, queryParams),
      ExamService.pool.query(improvementQuery, queryParams)
    ]);

    const improvement = improvementResult.rows[0] || { total_failed: 0, improved: 0, still_struggling: 0 };

    res.json({
      success: true,
      data: {
        timeframe,
        dailyProgress: progressResult.rows,
        improvement: {
          totalFailed: parseInt(improvement.total_failed) || 0,
          improved: parseInt(improvement.improved) || 0,
          stillStruggling: parseInt(improvement.still_struggling) || 0,
          improvementRate: improvement.total_failed > 0 
            ? ((improvement.improved / improvement.total_failed) * 100).toFixed(1)
            : 0
        }
      }
    });
  } catch (error) {
    logger.error('Get failed questions progress error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get failed questions progress'
    });
  }
};

// NEW: Mark a question as failed (manual tracking)
const markQuestionAsFailed = async (req, res) => {
  try {
    const userId = req.user.id;
    const { questionId, examId } = req.body;

    if (!questionId) {
      return res.status(400).json({
        success: false,
        error: 'Question ID is required'
      });
    }

    // Verify question exists
    const questionCheck = await ExamService.pool.query(
      'SELECT id FROM questions WHERE id = $1 AND is_active = true',
      [questionId]
    );

    if (questionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }

    // Log this as a failed attempt (could be tracked in a separate user_failed_questions table)
    // For now, we'll use the audit log
    await ExamService.pool.query(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, created_at)
      VALUES ($1, 'mark_failed', 'question', $2, $3, CURRENT_TIMESTAMP)
    `, [userId, questionId, JSON.stringify({ examId, markedManually: true })]);

    res.json({
      success: true,
      message: 'Question marked as failed',
      data: { questionId, markedAt: new Date().toISOString() }
    });
  } catch (error) {
    logger.error('Mark question as failed error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark question'
    });
  }
};

// NEW: Remove question from failed list (mastered)
const removeFromFailedQuestions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { questionId } = req.params;

    if (!questionId) {
      return res.status(400).json({
        success: false,
        error: 'Question ID is required'
      });
    }

    // Log the removal
    await ExamService.pool.query(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, created_at)
      VALUES ($1, 'remove_from_failed', 'question', $2, $3, CURRENT_TIMESTAMP)
    `, [userId, questionId, JSON.stringify({ removedManually: true })]);

    res.json({
      success: true,
      message: 'Question removed from failed list',
      data: { questionId, removedAt: new Date().toISOString() }
    });
  } catch (error) {
    logger.error('Remove from failed questions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove question from failed list'
    });
  }
};

// NEW: Get study recommendations based on performance
const getStudyRecommendations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { provider, certification } = req.query;

    let whereConditions = ['e.user_id = $1', 'e.status = $2'];
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

    // Find weak topics (lowest accuracy)
    const weakTopicsQuery = `
      SELECT 
        t.id as topic_id,
        t.name as topic_name,
        c.name as certification_name,
        COUNT(ua.id) as total_attempts,
        SUM(CASE WHEN ua.is_correct THEN 1 ELSE 0 END) as correct,
        ROUND(AVG(CASE WHEN ua.is_correct THEN 100.0 ELSE 0.0 END), 1) as accuracy,
        (SELECT COUNT(*) FROM questions q2 WHERE q2.topic_id = t.id AND q2.is_active = true) as available_questions
      FROM exam_answers ua
      JOIN questions q ON ua.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON ua.exam_id = e.id
      WHERE ${whereClause}
      GROUP BY t.id, t.name, c.name
      HAVING COUNT(ua.id) >= 3
      ORDER BY accuracy ASC
      LIMIT 5
    `;

    // Find recommended question count per topic
    const recommendedPracticeQuery = `
      SELECT 
        t.id as topic_id,
        t.name as topic_name,
        ROUND(AVG(CASE WHEN ua.is_correct THEN 100.0 ELSE 0.0 END), 1) as accuracy,
        CASE 
          WHEN AVG(CASE WHEN ua.is_correct THEN 100.0 ELSE 0.0 END) < 50 THEN 20
          WHEN AVG(CASE WHEN ua.is_correct THEN 100.0 ELSE 0.0 END) < 70 THEN 15
          WHEN AVG(CASE WHEN ua.is_correct THEN 100.0 ELSE 0.0 END) < 85 THEN 10
          ELSE 5
        END as recommended_questions
      FROM exam_answers ua
      JOIN questions q ON ua.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      JOIN exams e ON ua.exam_id = e.id
      WHERE ${whereClause}
      GROUP BY t.id, t.name
      ORDER BY accuracy ASC
      LIMIT 10
    `;

    // Get overall readiness score
    const readinessQuery = `
      SELECT 
        COALESCE(AVG(e.score), 0) as average_score,
        COUNT(DISTINCT e.id) as exams_taken,
        SUM(CASE WHEN e.passed THEN 1 ELSE 0 END) as exams_passed
      FROM exams e
      JOIN certifications c ON e.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      WHERE ${whereClause}
    `;

    const [weakTopics, recommendedPractice, readiness] = await Promise.all([
      ExamService.pool.query(weakTopicsQuery, queryParams),
      ExamService.pool.query(recommendedPracticeQuery, queryParams),
      ExamService.pool.query(readinessQuery, queryParams)
    ]);

    const readinessData = readiness.rows[0] || { average_score: 0, exams_taken: 0, exams_passed: 0 };
    const readinessScore = Math.min(100, Math.round(
      (parseFloat(readinessData.average_score) * 0.6) + 
      (Math.min(readinessData.exams_taken, 10) * 2) + 
      (readinessData.exams_passed * 5)
    ));

    res.json({
      success: true,
      data: {
        weakTopics: weakTopics.rows.map(row => ({
          topicId: row.topic_id,
          topicName: row.topic_name,
          certificationName: row.certification_name,
          accuracy: parseFloat(row.accuracy),
          totalAttempts: parseInt(row.total_attempts),
          availableQuestions: parseInt(row.available_questions),
          priority: row.accuracy < 50 ? 'high' : row.accuracy < 70 ? 'medium' : 'low'
        })),
        recommendedPractice: recommendedPractice.rows.map(row => ({
          topicId: row.topic_id,
          topicName: row.topic_name,
          currentAccuracy: parseFloat(row.accuracy),
          recommendedQuestions: parseInt(row.recommended_questions)
        })),
        readiness: {
          score: readinessScore,
          averageExamScore: parseFloat(readinessData.average_score).toFixed(1),
          examsTaken: parseInt(readinessData.exams_taken),
          examsPassed: parseInt(readinessData.exams_passed),
          recommendation: readinessScore >= 80 
            ? 'You are well-prepared for the certification exam!'
            : readinessScore >= 60 
              ? 'Keep practicing, you are getting close!'
              : 'Focus on your weak areas before attempting the certification.'
        }
      }
    });
  } catch (error) {
    logger.error('Get study recommendations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get study recommendations'
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
  getFailedQuestionsProgress,
  markQuestionAsFailed,
  removeFromFailedQuestions,
  getStudyRecommendations,
  getAllUsers,
  getUserById,
  updateUserRole,
  activateUser,
  deactivateUser,
  resetUserPassword,
  getUsersByRole
};