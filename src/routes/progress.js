/**
 * @fileoverview Progress routes — streaks + readiness.
 *
 * Mount: /api/progress
 */

const express = require('express');
const { getStreak, getReadiness } = require('../controllers/progressController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/streak',                       auth, getStreak);
router.get('/readiness/:certificationId',   auth, getReadiness);

module.exports = router;
