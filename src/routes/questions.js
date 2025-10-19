// src/routes/questions.js - Updated routes for PostgreSQL
const express = require('express');
const {
  getQuestions,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  getCategories,
  getProviders,
  getCertifications,
  getQuestionTypeStats,
  validateQuestion,
  getRandomQuestions,
  checkAnswer,
  getQuestionMetadata,
  getQuestionsByDifficulty,
  getQuestionTypes,
  getQuestionsForReview,
  approveQuestion,
  rejectQuestion,
  healthCheck,
  createSampleData
} = require('../controllers/questionController');
const { auth, adminAuth, optionalAuth } = require('../middleware/auth');
const { rateLimitMiddleware } = require('../middleware/rateLimit');
const { validateRequest } = require('../middleware/validation');

const router = express.Router();

// Health check route
router.get('/health', healthCheck);

// Public routes (no authentication required)
router.get('/', optionalAuth, getQuestions);
router.get('/types', getQuestionTypes);
router.get('/categories', getCategories);
router.get('/providers', getProviders);
router.get('/certifications', getCertifications);
router.get('/stats/types', getQuestionTypeStats);

// Public routes with rate limiting
router.get('/random', rateLimitMiddleware, optionalAuth, getRandomQuestions);
router.get('/difficulty/:difficulty', getQuestionsByDifficulty);

// Question-specific routes
router.get('/:id', optionalAuth, getQuestionById);
router.get('/:id/metadata', getQuestionMetadata);

// Routes that require some form of authentication (optional for some)
router.post('/validate', optionalAuth, validateQuestion);
router.post('/:id/check', rateLimitMiddleware, optionalAuth, checkAnswer);

// Admin routes - require admin authentication
router.get('/admin/review', adminAuth, getQuestionsForReview);
router.post('/admin/sample-data', adminAuth, createSampleData);
router.post('/', adminAuth, validateRequest('createQuestion'), createQuestion);
router.put('/:id', adminAuth, validateRequest('updateQuestion'), updateQuestion);
router.delete('/:id', adminAuth, deleteQuestion);
router.post('/:id/approve', adminAuth, approveQuestion);
router.post('/:id/reject', adminAuth, validateRequest('rejectQuestion'), rejectQuestion);

// Error handling middleware specific to questions
router.use((error, req, res, next) => {
  if (error.code === '23505') { // PostgreSQL unique violation
    return res.status(409).json({
      success: false,
      error: 'Question with this external ID already exists'
    });
  }
  
  if (error.code === '23503') { // PostgreSQL foreign key violation
    return res.status(400).json({
      success: false,
      error: 'Referenced entity (topic, certification, etc.) does not exist'
    });
  }
  
  if (error.code === '23514') { // PostgreSQL check constraint violation
    return res.status(400).json({
      success: false,
      error: 'Data violates database constraints'
    });
  }
  
  if (error.code === '22P02') { // PostgreSQL invalid input syntax
    return res.status(400).json({
      success: false,
      error: 'Invalid data format'
    });
  }
  
  if (error.code === '25P02') { // PostgreSQL transaction aborted
    return res.status(500).json({
      success: false,
      error: 'Transaction failed'
    });
  }
  
  next(error);
});

module.exports = router;

module.exports = router;