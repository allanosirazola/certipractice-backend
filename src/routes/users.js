const express = require('express');
const { 
  getUserStats, 
  getUserProgress,
  getUserBookmarks,
  getUserErrorResponses,
  getUserActivity,
  getFailedQuestions,
  getFailedQuestionsStats,
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

// NEW: Failed questions routes (authenticated users only)
router.get('/failed-questions', auth, getFailedQuestions);
router.get('/failed-questions/stats', auth, getFailedQuestionsStats);

// Admin and instructor routes
router.get('/', adminAuth, getAllUsers);
router.get('/role/:role', instructorAuth, getUsersByRole);

// Individual user management (admin only or own data)
router.get('/:id', auth, getUserById);
router.put('/:id/role', adminAuth, updateUserRole);
router.post('/:id/activate', adminAuth, activateUser);
router.post('/:id/deactivate', adminAuth, deactivateUser);
router.post('/:id/reset-password', adminAuth, resetUserPassword);

module.exports = router;