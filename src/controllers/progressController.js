/**
 * @fileoverview Progress Controller
 * Streaks + readiness endpoints. All require auth.
 */

const progressService = require('../services/progressService');
const logger = require('../utils/logger');

const getStreak = async (req, res) => {
  try {
    const userId = req.user?.id;
    const data = await progressService.getStreak(userId);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('Error in getStreak:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch streak' },
    });
  }
};

const getReadiness = async (req, res) => {
  try {
    const userId = req.user?.id;
    const certificationId = parseInt(req.params.certificationId, 10);

    if (!Number.isFinite(certificationId) || certificationId <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'certificationId must be a positive integer' },
      });
    }

    const data = await progressService.getReadiness(userId, certificationId);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('Error in getReadiness:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to estimate readiness' },
    });
  }
};

module.exports = {
  getStreak,
  getReadiness,
};
