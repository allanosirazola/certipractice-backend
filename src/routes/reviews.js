// src/routes/reviews.js
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { getDue, getStats, gradeReview } = require('../controllers/reviewController');

// All review endpoints require authentication (no anonymous spaced repetition)
router.get('/due',                       auth, getDue);
router.get('/stats',                     auth, getStats);
router.post('/:questionId/grade',        auth, gradeReview);

module.exports = router;
