/**
 * @fileoverview Engagement Service
 *
 * Handles bookmarks and personal notes — two simple per-user collections
 * that turn the practice app from a one-shot tool into a study companion.
 *
 * Notes:
 * - Both endpoints require authentication (userId is required everywhere).
 * - Bookmarks are unique per (user, question). A toggle is implemented as
 *   "create if missing, delete if present" via the dedicated toggle method.
 * - Notes are upserted: a user has at most one note per question, and
 *   updating it preserves the original `createdAt`.
 */

const pool = require('../database/pool');
const logger = require('../utils/logger');

const MAX_NOTE_LENGTH = 5000;

class EngagementService {
  // ─────────────────────────────────────────────────────────────────────
  // BOOKMARKS
  // ─────────────────────────────────────────────────────────────────────

  /**
   * List a user's bookmarked questions, most recent first.
   * Joins question metadata so the frontend can render previews
   * without a second roundtrip.
   *
   * @param {number} userId
   * @param {{limit?: number, offset?: number}} [opts]
   */
  async listBookmarks(userId, { limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const result = await pool.query(
      `SELECT
         b.id          AS bookmark_id,
         b.created_at  AS bookmarked_at,
         q.id          AS question_id,
         q.question_text,
         q.difficulty,
         t.name        AS topic_name,
         c.name        AS certification_name,
         p.name        AS provider_name,
         (n.content IS NOT NULL) AS has_note
       FROM bookmarks b
       JOIN questions      q ON b.question_id = q.id
       LEFT JOIN topics    t ON q.topic_id = t.id
       LEFT JOIN certifications c ON t.certification_id = c.id
       LEFT JOIN providers p ON c.provider_id = p.id
       LEFT JOIN question_notes n ON n.user_id = b.user_id AND n.question_id = b.question_id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, safeLimit, safeOffset]
    );

    const totalResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM bookmarks WHERE user_id = $1`,
      [userId]
    );

    return {
      items: result.rows.map((r) => ({
        bookmarkId: r.bookmark_id?.toString(),
        bookmarkedAt: r.bookmarked_at,
        questionId: r.question_id,
        questionText: r.question_text,
        difficulty: r.difficulty,
        topicName: r.topic_name,
        certificationName: r.certification_name,
        providerName: r.provider_name,
        hasNote: r.has_note,
      })),
      pagination: {
        total: totalResult.rows[0].total,
        limit: safeLimit,
        offset: safeOffset,
      },
    };
  }

  /**
   * Whether a question is bookmarked by a user.
   */
  async isBookmarked(userId, questionId) {
    const result = await pool.query(
      `SELECT EXISTS(
         SELECT 1 FROM bookmarks WHERE user_id = $1 AND question_id = $2
       ) AS exists`,
      [userId, questionId]
    );
    return result.rows[0].exists;
  }

  /**
   * Create a bookmark. Idempotent — re-bookmarking returns the existing row
   * instead of failing on the unique constraint.
   */
  async addBookmark(userId, questionId) {
    const result = await pool.query(
      `INSERT INTO bookmarks (user_id, question_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, question_id) DO UPDATE
         SET created_at = bookmarks.created_at
       RETURNING id, user_id, question_id, created_at`,
      [userId, questionId]
    );
    return this.#mapBookmark(result.rows[0]);
  }

  /**
   * Remove a bookmark. Returns true if a row was deleted.
   */
  async removeBookmark(userId, questionId) {
    const result = await pool.query(
      `DELETE FROM bookmarks WHERE user_id = $1 AND question_id = $2`,
      [userId, questionId]
    );
    return result.rowCount > 0;
  }

  /**
   * Toggle bookmark status. Returns the new state.
   */
  async toggleBookmark(userId, questionId) {
    const exists = await this.isBookmarked(userId, questionId);
    if (exists) {
      await this.removeBookmark(userId, questionId);
      return { bookmarked: false };
    }
    const created = await this.addBookmark(userId, questionId);
    return { bookmarked: true, bookmark: created };
  }

  // ─────────────────────────────────────────────────────────────────────
  // NOTES
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Get the user's note for a question, or null if none.
   */
  async getNote(userId, questionId) {
    const result = await pool.query(
      `SELECT id, user_id, question_id, content, created_at, updated_at
       FROM question_notes
       WHERE user_id = $1 AND question_id = $2`,
      [userId, questionId]
    );
    return result.rows[0] ? this.#mapNote(result.rows[0]) : null;
  }

  /**
   * Create or update a note (upsert).
   * @throws {Error} when content is empty or exceeds MAX_NOTE_LENGTH
   */
  async upsertNote(userId, questionId, content) {
    if (typeof content !== 'string') {
      const err = new Error('Note content must be a string');
      err.code = 'INVALID_NOTE';
      throw err;
    }
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      const err = new Error('Note content cannot be empty');
      err.code = 'EMPTY_NOTE';
      throw err;
    }
    if (trimmed.length > MAX_NOTE_LENGTH) {
      const err = new Error(`Note content exceeds ${MAX_NOTE_LENGTH} characters`);
      err.code = 'NOTE_TOO_LONG';
      throw err;
    }

    const result = await pool.query(
      `INSERT INTO question_notes (user_id, question_id, content)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, question_id) DO UPDATE
         SET content = EXCLUDED.content,
             updated_at = CURRENT_TIMESTAMP
       RETURNING id, user_id, question_id, content, created_at, updated_at`,
      [userId, questionId, trimmed]
    );
    return this.#mapNote(result.rows[0]);
  }

  /**
   * Delete a note. Returns true if a row was deleted.
   */
  async deleteNote(userId, questionId) {
    const result = await pool.query(
      `DELETE FROM question_notes WHERE user_id = $1 AND question_id = $2`,
      [userId, questionId]
    );
    return result.rowCount > 0;
  }

  /**
   * List all notes for a user, most recently updated first.
   */
  async listNotes(userId, { limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const result = await pool.query(
      `SELECT
         n.id, n.user_id, n.question_id, n.content, n.created_at, n.updated_at,
         q.question_text,
         t.name AS topic_name,
         c.name AS certification_name
       FROM question_notes n
       JOIN questions      q ON n.question_id = q.id
       LEFT JOIN topics    t ON q.topic_id = t.id
       LEFT JOIN certifications c ON t.certification_id = c.id
       WHERE n.user_id = $1
       ORDER BY n.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, safeLimit, safeOffset]
    );

    const totalResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM question_notes WHERE user_id = $1`,
      [userId]
    );

    return {
      items: result.rows.map((r) => ({
        ...this.#mapNote(r),
        questionText: r.question_text,
        topicName: r.topic_name,
        certificationName: r.certification_name,
      })),
      pagination: {
        total: totalResult.rows[0].total,
        limit: safeLimit,
        offset: safeOffset,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────

  #mapBookmark(row) {
    return {
      id: row.id?.toString(),
      userId: row.user_id,
      questionId: row.question_id,
      createdAt: row.created_at,
    };
  }

  #mapNote(row) {
    return {
      id: row.id?.toString(),
      userId: row.user_id,
      questionId: row.question_id,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = new EngagementService();
module.exports.EngagementService = EngagementService;
module.exports.MAX_NOTE_LENGTH = MAX_NOTE_LENGTH;
