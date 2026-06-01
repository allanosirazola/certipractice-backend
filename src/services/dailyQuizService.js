/**
 * @fileoverview Daily Quiz Service
 *
 * Generates a 5-question quiz per user per day. The selection is
 * deterministic within a day (re-calling getDailyQuiz returns the same
 * questions until UTC midnight rolls over), which lets the frontend
 * navigate away and come back without re-shuffling.
 *
 * Selection strategy (in priority order):
 *   1. Authenticated user with active reviews due → up to 3 SM-2 cards
 *   2. Fill remaining slots from random questions (preferring those the
 *      user hasn't answered recently)
 *   3. Anonymous users → 5 random easy/medium questions
 *
 * Completion is persisted server-side for authed users only;
 * client-side tracking covers anonymous.
 */

const pool = require('../database/pool');
const logger = require('../utils/logger');

const QUIZ_SIZE = 5;
const MAX_REVIEW_CARDS = 3;

/**
 * Get today's UTC date as 'YYYY-MM-DD'.
 *
 * Using UTC means the quiz rolls over at midnight UTC for everyone,
 * not at each user's local midnight. Simpler and avoids time-zone bugs;
 * the trade-off is users in earlier zones see a "new" quiz mid-evening.
 */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Stable hash-based RNG: same seed → same sequence.
 * Mulberry32 — small, fast, good-enough distribution for picking 5 of N.
 */
function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap, deterministic 32-bit hash of a string. */
function strHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

/** Pick N items deterministically given a seed. */
function pickSeeded(items, n, seed) {
  if (items.length <= n) return [...items];
  const rng = seededRng(seed);
  const pool = [...items];
  const out = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * Get (or compute) today's quiz for a user.
 *
 * @param {number|null} userId
 * @returns {Promise<{
 *   date: string,
 *   questions: Array<{ id, text, options, difficulty, topicName }>,
 *   completed: boolean,
 *   previousScore: number|null,
 * }>}
 */
async function getDailyQuiz(userId) {
  const date = todayUtc();

  // For authed users, check whether they've already finished today
  let completed = false;
  let previousScore = null;
  let savedQuestionIds = null;
  if (userId) {
    const existing = await pool.query(
      `SELECT score, question_ids
         FROM daily_quiz_completions
        WHERE user_id = $1 AND quiz_date = $2
        LIMIT 1`,
      [userId, date]
    );
    if (existing.rows[0]) {
      completed = true;
      previousScore = existing.rows[0].score;
      savedQuestionIds = existing.rows[0].question_ids;
    }
  }

  // If already completed, re-hydrate the same questions for review
  if (savedQuestionIds && Array.isArray(savedQuestionIds) && savedQuestionIds.length > 0) {
    const questions = await _loadQuestions(savedQuestionIds);
    return { date, questions, completed, previousScore };
  }

  // ── Pick the question set ──────────────────────────────────────────
  const ids = await _selectQuestionIds(userId, date);
  const questions = await _loadQuestions(ids);
  return { date, questions, completed, previousScore };
}

/**
 * Submit the user's answers and record completion.
 *
 * @param {number} userId
 * @param {string} date           'YYYY-MM-DD'; defaults to today
 * @param {Array<{ questionId: string, isCorrect: boolean }>} answers
 * @returns {Promise<{ score: number, total: number, alreadyCompleted: boolean }>}
 */
async function submitDailyQuiz(userId, answers, date = todayUtc()) {
  if (!userId) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  if (!Array.isArray(answers) || answers.length === 0) {
    throw Object.assign(new Error('answers must be a non-empty array'), { statusCode: 400 });
  }

  const score = answers.filter((a) => a && a.isCorrect === true).length;
  const total = answers.length;
  const questionIds = answers.map((a) => a.questionId).filter(Boolean);

  try {
    const result = await pool.query(
      `INSERT INTO daily_quiz_completions
         (user_id, quiz_date, score, total, question_ids, completed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
       ON CONFLICT (user_id, quiz_date) DO NOTHING
       RETURNING id`,
      [userId, date, score, total, JSON.stringify(questionIds)]
    );
    const alreadyCompleted = result.rowCount === 0;
    return { score, total, alreadyCompleted };
  } catch (err) {
    logger.error('submitDailyQuiz failed:', err);
    throw err;
  }
}

/**
 * Pick today's question IDs. Mixes SM-2 review cards with fresh picks,
 * deterministic per (user, date).
 */
async function _selectQuestionIds(userId, date) {
  const seed = strHash(`${userId || 'anon'}:${date}`);
  const ids = [];

  // 1) Reviews due today (auth only) — up to MAX_REVIEW_CARDS
  if (userId) {
    try {
      const due = await pool.query(
        `SELECT question_id
           FROM question_reviews
          WHERE user_id = $1 AND due_at <= NOW()
          ORDER BY due_at ASC
          LIMIT $2`,
        [userId, MAX_REVIEW_CARDS]
      );
      for (const row of due.rows) ids.push(row.question_id);
    } catch (err) {
      logger.warn('daily quiz: review fetch skipped:', err?.message);
    }
  }

  // 2) Fresh picks — random, exclude IDs already in the list.
  //    Pull a wider pool then pick deterministically with the seed so
  //    re-calls within the same day return the same set.
  const need = QUIZ_SIZE - ids.length;
  if (need > 0) {
    const exclude = ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'];
    const candidates = await pool.query(
      `SELECT id::text AS id
         FROM questions
        WHERE difficulty IN ('easy', 'medium')
          AND id <> ALL($1::uuid[])
        ORDER BY RANDOM()
        LIMIT $2`,
      [exclude, need * 4]
    );
    const picked = pickSeeded(candidates.rows.map((r) => r.id), need, seed);
    ids.push(...picked);
  }

  return ids;
}

/** Hydrate questions with their options + topic name. */
async function _loadQuestions(ids) {
  if (!ids || ids.length === 0) return [];
  const result = await pool.query(
    `SELECT q.id::text       AS id,
            q.question_text  AS text,
            q.difficulty     AS difficulty,
            q.explanation    AS explanation,
            t.name           AS topic_name,
            COALESCE(
              json_agg(
                json_build_object(
                  'id',        o.id,
                  'text',      o.option_text,
                  'isCorrect', o.is_correct
                ) ORDER BY o.order_index
              ) FILTER (WHERE o.id IS NOT NULL),
              '[]'::json
            ) AS options
       FROM questions q
       LEFT JOIN topics t ON t.id = q.topic_id
       LEFT JOIN question_options o ON o.question_id = q.id
      WHERE q.id::text = ANY($1::text[])
      GROUP BY q.id, t.name`,
    [ids]
  );

  // Preserve the input order — the selection algorithm chose this ordering
  const byId = new Map(result.rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((r) => ({
      id: r.id,
      text: r.text,
      difficulty: r.difficulty,
      explanation: r.explanation,
      topicName: r.topic_name,
      options: r.options,
    }));
}

/**
 * Has the authenticated user completed today's quiz?
 * Cheap O(1) query for the landing badge.
 */
async function hasCompletedToday(userId) {
  if (!userId) return false;
  const r = await pool.query(
    `SELECT 1 FROM daily_quiz_completions
      WHERE user_id = $1 AND quiz_date = $2 LIMIT 1`,
    [userId, todayUtc()]
  );
  return r.rowCount > 0;
}

module.exports = {
  getDailyQuiz,
  submitDailyQuiz,
  hasCompletedToday,
  // Exported for unit tests
  _internals: { todayUtc, seededRng, strHash, pickSeeded },
};
