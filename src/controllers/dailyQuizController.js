// src/controllers/dailyQuizController.js
const dailyQuizService = require('../services/dailyQuizService');
const logger = require('../utils/logger');

/**
 * GET /api/daily-quiz
 *
 * Returns today's 5 questions for the requester. Works for both
 * authenticated and anonymous users; anonymous users always get the
 * same anonymous pool (seeded by date only) and `completed: false`.
 */
async function getDaily(req, res) {
  try {
    const userId = req.user?.id || null;
    const data = await dailyQuizService.getDailyQuiz(userId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('dailyQuizController.getDaily:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
    });
  }
}

/**
 * POST /api/daily-quiz/submit
 *
 * Body: { answers: [{ questionId, isCorrect }] }
 *
 * Persists the completion. Auth required — anonymous users can play
 * the quiz but their state lives client-side (localStorage).
 */
async function submitDaily(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Sign in to save your daily quiz' },
      });
    }
    const { answers } = req.body || {};
    const result = await dailyQuizService.submitDailyQuiz(userId, answers);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: err.message },
      });
    }
    logger.error('dailyQuizController.submitDaily:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
    });
  }
}

/**
 * GET /api/daily-quiz/status
 *
 * Tiny endpoint for the landing badge: just answers "did you do it today?"
 */
async function getStatus(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.json({ success: true, data: { completed: false, authenticated: false } });
    }
    const completed = await dailyQuizService.hasCompletedToday(userId);
    res.json({ success: true, data: { completed, authenticated: true } });
  } catch (err) {
    logger.error('dailyQuizController.getStatus:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
    });
  }
}

module.exports = { getDaily, submitDaily, getStatus };
