// src/routes/dailyQuiz.js
const express = require('express');
const router = express.Router();
const { auth, optionalAuth } = require('../middleware/auth');
const { getDaily, submitDaily, getStatus } = require('../controllers/dailyQuizController');

// Public surfaces — both anonymous and authenticated work
router.get('/',         optionalAuth, getDaily);
router.get('/status',   optionalAuth, getStatus);

// Submission persists; auth required
router.post('/submit',  auth, submitDaily);

module.exports = router;
