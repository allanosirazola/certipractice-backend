/**
 * @fileoverview Engagement Controller
 * Endpoints for bookmarks and personal notes.
 */

const engagementService = require('../services/engagementService');
const telemetry = require('../services/telemetryService');
const logger = require('../utils/logger');

/* ─── Bookmarks ─────────────────────────────────────────────────────── */

const listBookmarks = async (req, res) => {
  try {
    const data = await engagementService.listBookmarks(req.user.id, {
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error('List bookmarks error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to load bookmarks' },
    });
  }
};

const checkBookmark = async (req, res) => {
  try {
    const exists = await engagementService.isBookmarked(req.user.id, req.params.questionId);
    res.json({ success: true, data: { bookmarked: exists } });
  } catch (error) {
    logger.error('Check bookmark error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to check bookmark' },
    });
  }
};

const toggleBookmark = async (req, res) => {
  try {
    const { questionId } = req.params;
    const result = await engagementService.toggleBookmark(req.user.id, questionId);

    // Telemetry: track bookmark/unbookmark events
    telemetry.trackQuestionEvent({
      questionId,
      eventType: result.bookmarked ? 'bookmarked' : 'unbookmarked',
      req,
    }).catch(() => {});

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Toggle bookmark error:', error);
    if (error.code === '23503') {
      return res.status(404).json({
        success: false,
        error: { code: 'QUESTION_NOT_FOUND', message: 'Question does not exist' },
      });
    }
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to toggle bookmark' },
    });
  }
};

const removeBookmark = async (req, res) => {
  try {
    const removed = await engagementService.removeBookmark(req.user.id, req.params.questionId);
    if (!removed) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Bookmark does not exist' },
      });
    }
    res.json({ success: true, data: { bookmarked: false } });
  } catch (error) {
    logger.error('Remove bookmark error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to remove bookmark' },
    });
  }
};

/* ─── Notes ─────────────────────────────────────────────────────────── */

const getNote = async (req, res) => {
  try {
    const note = await engagementService.getNote(req.user.id, req.params.questionId);
    if (!note) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: note });
  } catch (error) {
    logger.error('Get note error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to load note' },
    });
  }
};

const upsertNote = async (req, res) => {
  try {
    const note = await engagementService.upsertNote(
      req.user.id,
      req.params.questionId,
      req.body?.content
    );
    res.json({ success: true, data: note });
  } catch (error) {
    if (['INVALID_NOTE', 'EMPTY_NOTE', 'NOTE_TOO_LONG'].includes(error.code)) {
      return res.status(400).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
    }
    if (error.code === '23503') {
      return res.status(404).json({
        success: false,
        error: { code: 'QUESTION_NOT_FOUND', message: 'Question does not exist' },
      });
    }
    logger.error('Upsert note error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to save note' },
    });
  }
};

const deleteNote = async (req, res) => {
  try {
    const removed = await engagementService.deleteNote(req.user.id, req.params.questionId);
    if (!removed) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Note does not exist' },
      });
    }
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    logger.error('Delete note error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete note' },
    });
  }
};

const listNotes = async (req, res) => {
  try {
    const data = await engagementService.listNotes(req.user.id, {
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error('List notes error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to load notes' },
    });
  }
};

module.exports = {
  // bookmarks
  listBookmarks,
  checkBookmark,
  toggleBookmark,
  removeBookmark,
  // notes
  getNote,
  upsertNote,
  deleteNote,
  listNotes,
};
