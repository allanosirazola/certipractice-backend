// src/controllers/studyPlanController.js
const svc = require('../services/studyPlanService');
const logger = require('../utils/logger');

function requireUser(req, res) {
  if (!req.user?.id) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Sign in to manage your study plans' },
    });
    return null;
  }
  return req.user.id;
}

function handleError(err, res, label) {
  if (err.statusCode === 400) {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: err.message },
    });
  }
  logger.error(`${label}:`, err);
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: err.message },
  });
}

/**
 * POST /api/study-plans
 * Body: { certificationId, targetDate, dailyGoal? }
 */
async function createStudyPlan(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const data = await svc.createPlan(userId, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (err) {
    handleError(err, res, 'studyPlanController.create');
  }
}

/**
 * GET /api/study-plans/active
 * Lists all of the user's active plans.
 */
async function listActive(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const items = await svc.listActivePlans(userId);
    res.json({ success: true, data: { items } });
  } catch (err) {
    handleError(err, res, 'studyPlanController.listActive');
  }
}

/**
 * GET /api/study-plans/for-certification/:certificationId
 * Returns either the active plan for the cert, or null.
 */
async function getForCertification(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const id = parseInt(req.params.certificationId, 10);
    const plan = await svc.getActivePlanForCertification(userId, id);
    res.json({ success: true, data: plan });
  } catch (err) {
    handleError(err, res, 'studyPlanController.getForCertification');
  }
}

/**
 * DELETE /api/study-plans/:planId
 * Soft-cancel a plan.
 */
async function cancelPlan(req, res) {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const result = await svc.cancelPlan(userId, req.params.planId);
    res.json({ success: true, data: result });
  } catch (err) {
    handleError(err, res, 'studyPlanController.cancel');
  }
}

module.exports = { createStudyPlan, listActive, getForCertification, cancelPlan };
