// src/routes/studyPlans.js
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  createStudyPlan, listActive, getForCertification, cancelPlan,
} = require('../controllers/studyPlanController');

// All endpoints require authentication
router.post('/',                                       auth, createStudyPlan);
router.get('/active',                                  auth, listActive);
router.get('/for-certification/:certificationId',      auth, getForCertification);
router.delete('/:planId',                              auth, cancelPlan);

module.exports = router;
