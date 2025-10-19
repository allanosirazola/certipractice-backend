const express = require('express');
const { 
  register, 
  login, 
  getProfile, 
  updateProfile,
  changePassword,
  deleteAccount,
  refreshToken,
  validateEmail,
  logout
} = require('../controllers/authController');
const { auth, optionalAuth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Public routes
router.post('/register', optionalAuth, register); // optionalAuth to allow admin role assignment
router.post('/login', login);
router.post('/logout', logout);

// Protected routes
router.get('/profile', auth, getProfile);
router.put('/profile', auth, updateProfile);
router.post('/change-password', auth, changePassword);
router.post('/refresh-token', auth, refreshToken);
router.delete('/account', auth, deleteAccount);

// Email validation
router.post('/validate-email/:token', auth, validateEmail);

module.exports = router;