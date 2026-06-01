/**
 * @fileoverview Analytics Controller
 * Handles user progress tracking, statistics, and learning recommendations
 */

const logger = require('../utils/logger');
const pool = require('../database/pool');

/**
 * Get user learning progress across all certifications
 */
const getUserProgress = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get overall progress
    const overallQuery = `
      SELECT 
        COUNT(DISTINCT e.id) as total_exams,
        COUNT(DISTINCT CASE WHEN e.status = 'completed' THEN e.id END) as completed_exams,
        COUNT(DISTINCT CASE WHEN e.passed = true THEN e.id END) as passed_exams,
        COALESCE(AVG(CASE WHEN e.status = 'completed' THEN e.score END), 0) as average_score,
        COUNT(DISTINCT ua.question_id) as unique_questions_attempted,
        COUNT(DISTINCT CASE WHEN ua.is_correct = true THEN ua.question_id END) as unique_questions_correct
      FROM exams e
      LEFT JOIN exam_answers ua ON ua.exam_id = e.id
      WHERE e.user_id = $1
    `;

    // Get progress by certification
    const byCertificationQuery = `
      SELECT 
        c.id as certification_id,
        c.name as certification_name,
        p.name as provider_name,
        COUNT(DISTINCT e.id) as total_exams,
        COUNT(DISTINCT CASE WHEN e.status = 'completed' THEN e.id END) as completed_exams,
        COUNT(DISTINCT CASE WHEN e.passed = true THEN e.id END) as passed_exams,
        COALESCE(AVG(CASE WHEN e.status = 'completed' THEN e.score END), 0) as average_score,
        COUNT(DISTINCT ua.question_id) as questions_attempted,
        COUNT(DISTINCT CASE WHEN ua.is_correct = true THEN ua.question_id END) as questions_correct,
        (SELECT COUNT(*) FROM questions q 
         JOIN topics t ON q.topic_id = t.id 
         WHERE t.certification_id = c.id AND q.is_active = true) as total_questions
      FROM exams e
      JOIN certifications c ON e.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      LEFT JOIN exam_answers ua ON ua.exam_id = e.id
      WHERE e.user_id = $1
      GROUP BY c.id, c.name, p.name
      ORDER BY completed_exams DESC
    `;

    // Get recent activity
    const recentActivityQuery = `
      SELECT 
        e.id as exam_id,
        c.name as certification_name,
        e.status,
        e.score,
        e.passed,
        e.started_at,
        e.completed_at,
        e.question_count
      FROM exams e
      JOIN certifications c ON e.certification_id = c.id
      WHERE e.user_id = $1
      ORDER BY COALESCE(e.completed_at, e.started_at) DESC
      LIMIT 10
    `;

    // Get weekly progress
    const weeklyProgressQuery = `
      SELECT 
        DATE_TRUNC('day', e.completed_at) as date,
        COUNT(*) as exams_completed,
        AVG(e.score) as average_score,
        SUM(CASE WHEN e.passed THEN 1 ELSE 0 END) as exams_passed
      FROM exams e
      WHERE e.user_id = $1 
        AND e.status = 'completed'
        AND e.completed_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE_TRUNC('day', e.completed_at)
      ORDER BY date
    `;

    const [overallResult, byCertificationResult, recentActivityResult, weeklyProgressResult] = await Promise.all([
      pool.query(overallQuery, [userId]),
      pool.query(byCertificationQuery, [userId]),
      pool.query(recentActivityQuery, [userId]),
      pool.query(weeklyProgressQuery, [userId])
    ]);

    const overall = overallResult.rows[0];
    const accuracy = overall.unique_questions_attempted > 0 
      ? (overall.unique_questions_correct / overall.unique_questions_attempted * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      data: {
        overall: {
          totalExams: parseInt(overall.total_exams) || 0,
          completedExams: parseInt(overall.completed_exams) || 0,
          passedExams: parseInt(overall.passed_exams) || 0,
          averageScore: parseFloat(overall.average_score).toFixed(1) || 0,
          uniqueQuestionsAttempted: parseInt(overall.unique_questions_attempted) || 0,
          uniqueQuestionsCorrect: parseInt(overall.unique_questions_correct) || 0,
          accuracy: parseFloat(accuracy)
        },
        byCertification: byCertificationResult.rows.map(row => ({
          certificationId: row.certification_id,
          certificationName: row.certification_name,
          providerName: row.provider_name,
          totalExams: parseInt(row.total_exams),
          completedExams: parseInt(row.completed_exams),
          passedExams: parseInt(row.passed_exams),
          averageScore: parseFloat(row.average_score).toFixed(1),
          questionsAttempted: parseInt(row.questions_attempted),
          questionsCorrect: parseInt(row.questions_correct),
          totalQuestions: parseInt(row.total_questions),
          completionPercentage: row.total_questions > 0 
            ? ((row.questions_attempted / row.total_questions) * 100).toFixed(1)
            : 0
        })),
        recentActivity: recentActivityResult.rows,
        weeklyProgress: weeklyProgressResult.rows
      }
    });
  } catch (error) {
    logger.error('Get user progress error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user progress'
    });
  }
};

/**
 * Get detailed user statistics
 */
const getUserStats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Comprehensive stats query
    const statsQuery = `
      SELECT 
        -- Exam statistics
        COUNT(DISTINCT e.id) as total_exams,
        COUNT(DISTINCT CASE WHEN e.status = 'completed' THEN e.id END) as completed_exams,
        COUNT(DISTINCT CASE WHEN e.passed = true THEN e.id END) as passed_exams,
        COUNT(DISTINCT CASE WHEN e.status = 'active' THEN e.id END) as active_exams,
        
        -- Score statistics
        COALESCE(AVG(CASE WHEN e.status = 'completed' THEN e.score END), 0) as average_score,
        COALESCE(MAX(CASE WHEN e.status = 'completed' THEN e.score END), 0) as best_score,
        COALESCE(MIN(CASE WHEN e.status = 'completed' THEN e.score END), 0) as worst_score,
        
        -- Question statistics
        COUNT(ua.id) as total_answers,
        SUM(CASE WHEN ua.is_correct = true THEN 1 ELSE 0 END) as correct_answers,
        SUM(CASE WHEN ua.is_correct = false THEN 1 ELSE 0 END) as incorrect_answers,
        
        -- Time statistics
        COALESCE(SUM(ua.time_spent), 0) as total_time_spent,
        COALESCE(AVG(ua.time_spent), 0) as average_time_per_question,
        
        -- Streak calculation
        (SELECT COUNT(*) FROM (
          SELECT e2.completed_at::date as exam_date
          FROM exams e2 
          WHERE e2.user_id = $1 
            AND e2.status = 'completed'
            AND e2.completed_at >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY e2.completed_at::date
        ) dates) as days_active_last_30
        
      FROM exams e
      LEFT JOIN exam_answers ua ON ua.exam_id = e.id
      WHERE e.user_id = $1
    `;

    // Stats by difficulty
    const difficultyQuery = `
      SELECT 
        q.difficulty as difficulty,
        COUNT(ua.id) as total_attempts,
        SUM(CASE WHEN ua.is_correct THEN 1 ELSE 0 END) as correct,
        ROUND(AVG(CASE WHEN ua.is_correct THEN 100.0 ELSE 0.0 END), 1) as accuracy
      FROM exam_answers ua
      JOIN questions q ON ua.question_id = q.id
      JOIN exams e ON ua.exam_id = e.id
      WHERE e.user_id = $1
      GROUP BY q.difficulty
      ORDER BY 
        CASE q.difficulty 
          WHEN 'easy' THEN 1 
          WHEN 'medium' THEN 2 
          WHEN 'hard' THEN 3 
          WHEN 'expert' THEN 4 
        END
    `;

    // Stats by topic
    const topicQuery = `
      SELECT 
        t.name as topic,
        c.name as certification,
        COUNT(ua.id) as total_attempts,
        SUM(CASE WHEN ua.is_correct THEN 1 ELSE 0 END) as correct,
        ROUND(AVG(CASE WHEN ua.is_correct THEN 100.0 ELSE 0.0 END), 1) as accuracy
      FROM exam_answers ua
      JOIN questions q ON ua.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN exams e ON ua.exam_id = e.id
      WHERE e.user_id = $1
      GROUP BY t.id, t.name, c.name
      ORDER BY accuracy ASC
      LIMIT 10
    `;

    const [statsResult, difficultyResult, topicResult] = await Promise.all([
      pool.query(statsQuery, [userId]),
      pool.query(difficultyQuery, [userId]),
      pool.query(topicQuery, [userId])
    ]);

    const stats = statsResult.rows[0];
    const totalAnswers = parseInt(stats.total_answers) || 0;
    const correctAnswers = parseInt(stats.correct_answers) || 0;

    res.json({
      success: true,
      data: {
        exams: {
          total: parseInt(stats.total_exams) || 0,
          completed: parseInt(stats.completed_exams) || 0,
          passed: parseInt(stats.passed_exams) || 0,
          active: parseInt(stats.active_exams) || 0,
          passRate: stats.completed_exams > 0 
            ? ((stats.passed_exams / stats.completed_exams) * 100).toFixed(1)
            : 0
        },
        scores: {
          average: parseFloat(stats.average_score).toFixed(1),
          best: parseFloat(stats.best_score).toFixed(1),
          worst: parseFloat(stats.worst_score).toFixed(1)
        },
        questions: {
          totalAnswered: totalAnswers,
          correct: correctAnswers,
          incorrect: parseInt(stats.incorrect_answers) || 0,
          accuracy: totalAnswers > 0 
            ? ((correctAnswers / totalAnswers) * 100).toFixed(1)
            : 0
        },
        time: {
          totalMinutes: Math.round(parseInt(stats.total_time_spent) / 60) || 0,
          averagePerQuestion: Math.round(parseFloat(stats.average_time_per_question)) || 0
        },
        activity: {
          daysActiveLast30: parseInt(stats.days_active_last_30) || 0
        },
        byDifficulty: difficultyResult.rows,
        weakestTopics: topicResult.rows
      }
    });
  } catch (error) {
    logger.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user statistics'
    });
  }
};

/**
 * Get learning recommendations based on user performance
 */
const getRecommendations = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find weak areas (topics with low accuracy)
    const weakAreasQuery = `
      SELECT 
        t.id as topic_id,
        t.name as topic_name,
        c.id as certification_id,
        c.name as certification_name,
        p.name as provider_name,
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
      WHERE e.user_id = $1
      GROUP BY t.id, t.name, c.id, c.name, p.name
      HAVING COUNT(ua.id) >= 3
      ORDER BY accuracy ASC
      LIMIT 5
    `;

    // Find untouched topics in certifications the user is studying
    const untouchedTopicsQuery = `
      SELECT DISTINCT
        t.id as topic_id,
        t.name as topic_name,
        c.id as certification_id,
        c.name as certification_name,
        (SELECT COUNT(*) FROM questions q WHERE q.topic_id = t.id AND q.is_active = true) as available_questions
      FROM topics t
      JOIN certifications c ON t.certification_id = c.id
      WHERE c.id IN (
        SELECT DISTINCT certification_id FROM exams WHERE user_id = $1
      )
      AND t.id NOT IN (
        SELECT DISTINCT q.topic_id
        FROM exam_answers ua
        JOIN questions q ON ua.question_id = q.id
        JOIN exams e ON ua.exam_id = e.id
        WHERE e.user_id = $1
      )
      AND t.is_active = true
      LIMIT 5
    `;

    // Find questions to retry (failed multiple times)
    const retryQuestionsQuery = `
      SELECT 
        q.id as question_id,
        LEFT(q.question_text, 100) as question_preview,
        q.difficulty as difficulty,
        t.name as topic_name,
        COUNT(ua.id) as failed_count,
        MAX(ua.answered_at) as last_failed
      FROM exam_answers ua
      JOIN questions q ON ua.question_id = q.id
      JOIN topics t ON q.topic_id = t.id
      JOIN exams e ON ua.exam_id = e.id
      WHERE e.user_id = $1 
        AND ua.is_correct = false
        AND q.is_active = true
      GROUP BY q.id, q.question_text, q.difficulty, t.name
      HAVING COUNT(ua.id) >= 2
      ORDER BY failed_count DESC, last_failed DESC
      LIMIT 10
    `;

    // Get suggested next actions
    const suggestedActionsQuery = `
      SELECT 
        c.id as certification_id,
        c.name as certification_name,
        p.name as provider_name,
        COUNT(DISTINCT e.id) as exams_taken,
        COALESCE(AVG(e.score), 0) as average_score,
        MAX(e.completed_at) as last_exam_date,
        CASE 
          WHEN COALESCE(AVG(e.score), 0) < 60 THEN 'practice_more'
          WHEN COALESCE(AVG(e.score), 0) < 80 THEN 'review_weak_areas'
          WHEN COUNT(DISTINCT e.id) < 5 THEN 'take_more_exams'
          ELSE 'ready_for_certification'
        END as suggested_action
      FROM exams e
      JOIN certifications c ON e.certification_id = c.id
      JOIN providers p ON c.provider_id = p.id
      WHERE e.user_id = $1 AND e.status = 'completed'
      GROUP BY c.id, c.name, p.name
      ORDER BY last_exam_date DESC
    `;

    const [weakAreas, untouchedTopics, retryQuestions, suggestedActions] = await Promise.all([
      pool.query(weakAreasQuery, [userId]),
      pool.query(untouchedTopicsQuery, [userId]),
      pool.query(retryQuestionsQuery, [userId]),
      pool.query(suggestedActionsQuery, [userId])
    ]);

    res.json({
      success: true,
      data: {
        weakAreas: weakAreas.rows.map(row => ({
          topicId: row.topic_id,
          topicName: row.topic_name,
          certificationId: row.certification_id,
          certificationName: row.certification_name,
          providerName: row.provider_name,
          accuracy: parseFloat(row.accuracy),
          totalAttempts: parseInt(row.total_attempts),
          availableQuestions: parseInt(row.available_questions),
          recommendation: `Focus on ${row.topic_name} - your accuracy is ${row.accuracy}%`
        })),
        untouchedTopics: untouchedTopics.rows.map(row => ({
          topicId: row.topic_id,
          topicName: row.topic_name,
          certificationId: row.certification_id,
          certificationName: row.certification_name,
          availableQuestions: parseInt(row.available_questions),
          recommendation: `Start practicing ${row.topic_name} - ${row.available_questions} questions available`
        })),
        questionsToRetry: retryQuestions.rows.map(row => ({
          questionId: row.question_id,
          preview: row.question_preview,
          difficulty: row.difficulty,
          topicName: row.topic_name,
          failedCount: parseInt(row.failed_count)
        })),
        certificationSuggestions: suggestedActions.rows.map(row => ({
          certificationId: row.certification_id,
          certificationName: row.certification_name,
          providerName: row.provider_name,
          examsTaken: parseInt(row.exams_taken),
          averageScore: parseFloat(row.average_score).toFixed(1),
          suggestedAction: row.suggested_action,
          actionMessage: getActionMessage(row.suggested_action, row.certification_name)
        }))
      }
    });
  } catch (error) {
    logger.error('Get recommendations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recommendations'
    });
  }
};

/**
 * Helper function to get action message
 */
const getActionMessage = (action, certName) => {
  const messages = {
    'practice_more': `Keep practicing ${certName} - aim for at least 60% average`,
    'review_weak_areas': `Review weak areas in ${certName} to improve your score`,
    'take_more_exams': `Take more practice exams for ${certName} to build confidence`,
    'ready_for_certification': `You're doing great! Consider scheduling the ${certName} exam`
  };
  return messages[action] || `Continue studying ${certName}`;
};

/**
 * Track user activity
 */
const trackActivity = async (req, res) => {
  try {
    const userId = req.user?.id;
    const sessionId = req.headers['x-session-id'];
    const { activityType, metadata } = req.body;

    if (!activityType) {
      return res.status(400).json({
        success: false,
        error: 'Activity type is required'
      });
    }

    const validActivityTypes = [
      'page_view', 'exam_start', 'exam_complete', 'question_answer',
      'login', 'logout', 'study_session_start', 'study_session_end'
    ];

    if (!validActivityTypes.includes(activityType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid activity type'
      });
    }

    // Log activity into audit_logs (real schema: entity_id required, payload
    // goes in new_values; there is no `metadata` column).
    const query = `
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent, created_at)
      VALUES ($1, $2, 'activity', $3, $4, $5, $6, NOW())
      RETURNING id
    `;

    const result = await pool.query(query, [
      userId || null,
      activityType,
      sessionId || 'anonymous',
      JSON.stringify({ ...metadata, sessionId }),
      req.ip,
      req.headers['user-agent']
    ]);

    res.json({
      success: true,
      data: {
        tracked: true,
        activityId: result.rows[0]?.id
      }
    });
  } catch (error) {
    logger.error('Track activity error:', error);
    // Don't fail the request for analytics errors
    res.json({
      success: true,
      data: { tracked: false }
    });
  }
};

module.exports = {
  getUserProgress,
  getUserStats,
  getRecommendations,
  trackActivity
};
