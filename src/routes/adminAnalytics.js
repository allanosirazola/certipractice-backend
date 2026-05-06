/**
 * @fileoverview Admin Analytics Routes
 * All routes require admin authentication.
 *
 * Mount: /api/admin/analytics
 */

const express = require('express');
const {
  getOverview,
  getExamAnalytics,
  getQuestionAnalytics,
  getUserAnalytics,
  getFunnel,
  getTimeseries,
  triggerDailyComputation,
} = require('../controllers/adminAnalyticsController');
const { adminAuth } = require('../middleware/auth');

const router = express.Router();

// All admin analytics routes require admin authentication
router.use(adminAuth);

router.get('/overview', getOverview);
router.get('/exams', getExamAnalytics);
router.get('/questions', getQuestionAnalytics);
router.get('/users', getUserAnalytics);
router.get('/funnel', getFunnel);
router.get('/timeseries', getTimeseries);
router.post('/compute-daily', triggerDailyComputation);

module.exports = router;
