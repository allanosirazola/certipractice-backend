// src/controllers/reviewController.js
const reviewService = require('../services/reviewService');
const logger = require('../utils/logger');

/**
 * GET /api/reviews/due
 *
 * Query params:
 *   - limit            (default 20, max 100)
 *   - certificationId  (optional filter)
 *
 * Returns the spaced-repetition cards that are due now.
 */
async function getDue(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Sign in to use spaced repetition' },
      });
    }
    const { limit, certificationId } = req.query;
    const data = await reviewService.getDueItems(userId, { limit, certificationId });
    res.json({ success: true, data });
  } catch (err) {
    logger.error('reviewController.getDue:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}

/**
 * GET /api/reviews/stats
 *
 * Returns aggregated stats for the user's review queue.
 */
async function getStats(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Sign in to use spaced repetition' },
      });
    }
    const data = await reviewService.getStats(userId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('reviewController.getStats:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}

/**
 * POST /api/reviews/:questionId/grade
 *
 * Body: { quality: 0|1|2|3 } or { quality: "again"|"hard"|"good"|"easy" }
 *
 * Records a grading and returns the updated review row.
 */
async function gradeReview(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Sign in to grade reviews' },
      });
    }
    const { questionId } = req.params;
    const { quality } = req.body || {};
    const updated = await reviewService.gradeReview(userId, questionId, quality);
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: err.message },
      });
    }
    logger.error('reviewController.gradeReview:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}

module.exports = {
  getDue,
  getStats,
  gradeReview,
};
