/**
 * @fileoverview Search Service
 *
 * Full-text search over the question bank using PostgreSQL's tsvector
 * (column `search_vector` is generated and indexed by a GIN, see migration
 * 20260510_add_engagement).
 *
 * Strategy:
 *   - Sanitize the user query into a tsquery using `plainto_tsquery` for
 *     short inputs and `websearch_to_tsquery` for natural language.
 *     `websearch_to_tsquery` understands quoted phrases and OR / -terms.
 *   - Rank with `ts_rank_cd` and order by rank desc.
 *   - Optional filters: certificationId, providerId, difficulty.
 *   - Hard limit 50 to avoid runaway queries.
 *
 * Returns lightweight rows (id, preview, topic, etc.) — full content is
 * fetched via the existing `GET /questions/:id` endpoint.
 */

const pool = require('../database/pool');
const logger = require('../utils/logger');

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

class SearchService {
  /**
   * Search questions matching the user's query.
   *
   * @param {string} rawQuery
   * @param {object} [filters]
   * @param {number} [filters.certificationId]
   * @param {number} [filters.providerId]
   * @param {string} [filters.difficulty]
   * @param {number} [filters.limit]
   * @param {number} [filters.offset]
   * @returns {Promise<{items: Array, query: string, pagination: object}>}
   */
  async searchQuestions(rawQuery, filters = {}) {
    const validation = this.#validateQuery(rawQuery);
    if (!validation.valid) {
      const err = new Error(validation.error);
      err.code = validation.code;
      throw err;
    }
    const cleanQuery = validation.value;

    const safeLimit = Math.min(
      Math.max(parseInt(filters.limit, 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const safeOffset = Math.max(parseInt(filters.offset, 10) || 0, 0);

    // Build dynamic WHERE: search + optional filters
    const conditions = [
      `q.search_vector @@ websearch_to_tsquery('simple', $1)`,
      `q.review_status = 'approved'`,
    ];
    const params = [cleanQuery];
    let p = 2;

    if (filters.certificationId) {
      conditions.push(`t.certification_id = $${p++}`);
      params.push(parseInt(filters.certificationId, 10));
    }
    if (filters.providerId) {
      conditions.push(`c.provider_id = $${p++}`);
      params.push(parseInt(filters.providerId, 10));
    }
    if (filters.difficulty && ['easy', 'medium', 'hard', 'expert'].includes(filters.difficulty)) {
      conditions.push(`q.difficulty = $${p++}::"Difficulty"`);
      params.push(filters.difficulty);
    }

    const whereSql = conditions.join(' AND ');

    try {
      const itemsParams = [...params, safeLimit, safeOffset];
      const limitParam = p;
      const offsetParam = p + 1;

      const itemsResult = await pool.query(
        `SELECT
           q.id,
           q.question_text,
           q.difficulty,
           t.name AS topic_name,
           c.name AS certification_name,
           p.name AS provider_name,
           ts_rank_cd(q.search_vector, websearch_to_tsquery('simple', $1)) AS rank,
           ts_headline(
             'simple', q.question_text,
             websearch_to_tsquery('simple', $1),
             'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=5'
           ) AS snippet
         FROM questions q
         JOIN topics t ON q.topic_id = t.id
         JOIN certifications c ON t.certification_id = c.id
         JOIN providers p ON c.provider_id = p.id
         WHERE ${whereSql}
         ORDER BY rank DESC, q.id
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        itemsParams
      );

      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM questions q
         JOIN topics t ON q.topic_id = t.id
         JOIN certifications c ON t.certification_id = c.id
         WHERE ${whereSql}`,
        params
      );

      return {
        query: cleanQuery,
        items: itemsResult.rows.map((r) => ({
          questionId: r.id,
          preview: r.question_text.length > 200
            ? r.question_text.substring(0, 200) + '…'
            : r.question_text,
          snippet: r.snippet,
          rank: parseFloat(r.rank),
          difficulty: r.difficulty,
          topicName: r.topic_name,
          certificationName: r.certification_name,
          providerName: r.provider_name,
        })),
        pagination: {
          total: countResult.rows[0].total,
          limit: safeLimit,
          offset: safeOffset,
          hasMore: countResult.rows[0].total > safeOffset + itemsResult.rows.length,
        },
      };
    } catch (error) {
      logger.error('Search query failed:', error);
      throw error;
    }
  }

  /**
   * Suggest completions for a partial query (typeahead).
   * Returns up to 8 distinct topic names matching the prefix.
   */
  async suggest(rawQuery) {
    const validation = this.#validateQuery(rawQuery, /* allowShort */ true);
    if (!validation.valid) return { suggestions: [] };

    const result = await pool.query(
      `SELECT DISTINCT t.name
       FROM topics t
       WHERE t.name ILIKE $1
       ORDER BY t.name
       LIMIT 8`,
      [`%${validation.value}%`]
    );

    return { suggestions: result.rows.map((r) => r.name) };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────

  #validateQuery(rawQuery, allowShort = false) {
    if (typeof rawQuery !== 'string') {
      return { valid: false, code: 'INVALID_QUERY', error: 'Query must be a string' };
    }
    const trimmed = rawQuery.trim();
    if (trimmed.length === 0) {
      return { valid: false, code: 'EMPTY_QUERY', error: 'Query cannot be empty' };
    }
    if (!allowShort && trimmed.length < MIN_QUERY_LENGTH) {
      return {
        valid: false,
        code: 'QUERY_TOO_SHORT',
        error: `Query must be at least ${MIN_QUERY_LENGTH} characters`,
      };
    }
    if (trimmed.length > MAX_QUERY_LENGTH) {
      return {
        valid: false,
        code: 'QUERY_TOO_LONG',
        error: `Query exceeds ${MAX_QUERY_LENGTH} characters`,
      };
    }
    return { valid: true, value: trimmed };
  }
}

module.exports = new SearchService();
module.exports.SearchService = SearchService;
module.exports.MIN_QUERY_LENGTH = MIN_QUERY_LENGTH;
module.exports.MAX_QUERY_LENGTH = MAX_QUERY_LENGTH;
module.exports.MAX_LIMIT = MAX_LIMIT;
