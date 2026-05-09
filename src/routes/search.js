/**
 * @fileoverview Search Routes
 * Mounted at /api/search.
 *
 * Public access (optionalAuth) so anonymous users can browse the bank.
 * The full question content still goes through the regular auth flow.
 */

const express = require('express');
const router = express.Router();

const { optionalAuth } = require('../middleware/auth');
const { searchRateLimit } = require('../middleware/rateLimit');
const { searchQuestions, suggestQuestions } = require('../controllers/searchController');

router.get('/questions', optionalAuth, searchRateLimit, searchQuestions);
router.get('/suggest',   optionalAuth, searchRateLimit, suggestQuestions);

module.exports = router;
