/**
 * @fileoverview Search Controller
 * Full-text search over the question bank.
 */

const searchService = require('../services/searchService');
const telemetry = require('../services/telemetryService');
const logger = require('../utils/logger');

const searchQuestions = async (req, res) => {
  const query = req.query.q || req.query.query || '';

  try {
    const result = await searchService.searchQuestions(query, {
      certificationId: req.query.certificationId,
      providerId: req.query.providerId,
      difficulty: req.query.difficulty,
      limit: req.query.limit,
      offset: req.query.offset,
    });

    // Telemetry: track search query (only if it returned results)
    telemetry.trackUserActivity({
      activityType: 'search',
      req,
      metadata: {
        query: result.query,
        resultCount: result.items.length,
        certificationId: req.query.certificationId,
        providerId: req.query.providerId,
        difficulty: req.query.difficulty,
      },
    }).catch(() => {});

    res.json({ success: true, data: result });
  } catch (error) {
    if (['INVALID_QUERY', 'EMPTY_QUERY', 'QUERY_TOO_SHORT', 'QUERY_TOO_LONG'].includes(error.code)) {
      return res.status(400).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
    }
    logger.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Search failed' },
    });
  }
};

const suggestQuestions = async (req, res) => {
  try {
    const result = await searchService.suggest(req.query.q || '');
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Suggest error:', error);
    // Soft-fail: return empty list rather than error to keep typeahead snappy
    res.json({ success: true, data: { suggestions: [] } });
  }
};

module.exports = {
  searchQuestions,
  suggestQuestions,
};
