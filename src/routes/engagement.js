/**
 * @fileoverview Engagement Routes
 * Mounted at /api/engagement.
 *
 * All endpoints require authentication. Anonymous users cannot bookmark
 * or take notes — those features are designed to encourage sign-up.
 */

const express = require('express');
const router = express.Router();

const { auth } = require('../middleware/auth');
const {
  listBookmarks, checkBookmark, toggleBookmark, removeBookmark,
  getNote, upsertNote, deleteNote, listNotes,
} = require('../controllers/engagementController');

/* ─── Bookmarks ─────────────────────────────────────────────────────── */
router.get('/bookmarks',                          auth, listBookmarks);
router.get('/bookmarks/:questionId',              auth, checkBookmark);
router.post('/bookmarks/:questionId/toggle',      auth, toggleBookmark);
router.delete('/bookmarks/:questionId',           auth, removeBookmark);

/* ─── Notes ─────────────────────────────────────────────────────────── */
router.get('/notes',                              auth, listNotes);
router.get('/notes/:questionId',                  auth, getNote);
router.put('/notes/:questionId',                  auth, upsertNote);
router.delete('/notes/:questionId',               auth, deleteNote);

module.exports = router;
