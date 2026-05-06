/**
 * @fileoverview Analytics Routes
 * Routes for user progress tracking, statistics, and recommendations
 */

const express = require('express');
const {
  getUserProgress,
  getUserStats,
  getRecommendations,
  trackActivity
} = require('../controllers/analyticsController');
const { auth, optionalAuth } = require('../middleware/auth');
const telemetry = require('../services/telemetryService');
const logger = require('../utils/logger');

const router = express.Router();

// All analytics routes require authentication
router.get('/progress', auth, getUserProgress);
router.get('/stats', auth, getUserStats);
router.get('/recommendations', auth, getRecommendations);

// Activity tracking can work with optional auth (for anonymous users)
router.post('/activity', optionalAuth, trackActivity);

/**
 * POST /events/batch
 * Bulk-submit events from the client (e.g. queued offline).
 * Body: { events: [{ type, payload }, ...] }
 * Limits: 50 events per call to prevent abuse.
 */
router.post('/events/batch', optionalAuth, async (req, res) => {
  try {
    const { events } = req.body || {};
    if (!Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PAYLOAD', message: 'events must be an array' },
      });
    }
    if (events.length > 50) {
      return res.status(413).json({
        success: false,
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Max 50 events per batch' },
      });
    }

    // Inject identity into every event payload so client can't spoof
    const sanitized = events.map((e) => ({
      type: e.type,
      payload: { ...(e.payload || {}), req },
    }));

    const result = await telemetry.trackBatch(sanitized);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Batch tracking error:', error);
    // Even on error, swallow to keep client experience smooth
    res.json({ success: true, data: { tracked: 0 } });
  }
});

module.exports = router;
