const express = require('express');
const { 
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
} = require('../controllers/userController');
const { auth, adminAuth, instructorAuth } = require('../middleware/auth');

const router = express.Router();

// User's own data routes
router.get('/stats', auth, getUserStats);
router.get('/progress', auth, getUserProgress);
router.get('/bookmarks', auth, getUserBookmarks);
router.get('/error-responses', auth, getUserErrorResponses);
router.get('/activity', auth, getUserActivity);

// Failed questions routes (authenticated users only)
router.get('/failed-questions', auth, getFailedQuestions);
router.get('/failed-questions/stats', auth, getFailedQuestionsStats);
router.get('/failed-questions/progress', auth, getFailedQuestionsProgress);
router.post('/failed-questions', auth, markQuestionAsFailed);
router.delete('/failed-questions/:questionId', auth, removeFromFailedQuestions);

// Study recommendations
router.get('/study-recommendations', auth, getStudyRecommendations);

// Admin routes - must come before /:id to avoid conflicts
router.get('/admin', adminAuth, getAllUsers);
router.get('/role/:role', instructorAuth, getUsersByRole);

// Individual user management (admin only or own data)
router.get('/:id', auth, getUserById);
router.put('/:id/role', adminAuth, updateUserRole);
router.post('/:id/activate', adminAuth, activateUser);
router.post('/:id/deactivate', adminAuth, deactivateUser);
router.post('/:id/reset-password', adminAuth, resetUserPassword);

module.exports = router;