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

const router = express.Router();

// All analytics routes require authentication
router.get('/progress', auth, getUserProgress);
router.get('/stats', auth, getUserStats);
router.get('/recommendations', auth, getRecommendations);

// Activity tracking can work with optional auth (for anonymous users)
router.post('/activity', optionalAuth, trackActivity);

module.exports = router;
