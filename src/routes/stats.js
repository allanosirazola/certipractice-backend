const express = require('express');
const { getGlobalStats, getQuestionStats } = require('../controllers/statsController');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/global', getGlobalStats);
router.get('/questions', adminAuth, getQuestionStats);

module.exports = router;
