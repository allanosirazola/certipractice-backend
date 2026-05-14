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
  logout,
  verifyToken,
  verifyEmail,
  resendVerification
} = require('../controllers/authController');
const { auth, optionalAuth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Public routes
router.post('/register', optionalAuth, register); // optionalAuth to allow admin role assignment
router.post('/login', login);

// Email verification — both endpoints are intentionally public so that a
// user with an expired session can still finish or restart the flow.
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', optionalAuth, resendVerification);
router.post('/logout', logout);

// Token verification
router.get('/verify', auth, verifyToken);

// Protected routes
router.get('/profile', auth, getProfile);
router.put('/profile', auth, updateProfile);
router.post('/change-password', auth, changePassword);
router.post('/refresh', auth, refreshToken);
router.post('/refresh-token', auth, refreshToken); // Alias for compatibility
router.post('/delete', auth, deleteAccount);
router.delete('/account', auth, deleteAccount); // Alias for compatibility

// Email validation
router.post('/validate/:token', auth, validateEmail);
router.post('/validate-email/:token', auth, validateEmail); // Alias for compatibility

module.exports = router;