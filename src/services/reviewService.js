/**
 * @fileoverview Spaced Repetition Service (SM-2 algorithm)
 *
 * Implements a simplified SuperMemo-2 scheduler. One row per (user, question).
 *
 * Quality grades (matches Anki's "again/hard/good/easy"):
 *   0  again  → reset interval to 1 day, drop ease
 *   1  hard   → reduce ease, shorter interval
 *   2  good   → keep ease, normal interval
 *   3  easy   → bump ease, longer interval
 *
 * Ease factor is clamped to [1.3, 3.0] to prevent runaway growth or stagnation.
 *
 * All public methods are safe to call on anonymous users: they return early
 * with a no-op result rather than throwing.
 */

const pool = require('../database/pool');
const logger = require('../utils/logger');

const EASE_MIN = 1.3;
const EASE_MAX = 3.0;
const EASE_DEFAULT = 2.5;

// Quality grade tokens accepted by gradeReview()
const QUALITIES = { again: 0, hard: 1, good: 2, easy: 3 };

/**
 * Compute the next review schedule given the current state and a grade.
 *
 * @param {{ easeFactor: number, intervalDays: number, repetitions: number, lapses: number }} state
 * @param {number} quality 0..3
 * @returns {{ easeFactor: number, intervalDays: number, repetitions: number, lapses: number, dueAt: Date }}
 */
function nextSchedule(state, quality) {
  const ease = clampEase(Number(state?.easeFactor) || EASE_DEFAULT);
  const reps = Math.max(0, Number(state?.repetitions) || 0);
  const prevInterval = Math.max(0, Number(state?.intervalDays) || 0);
  const lapses = Math.max(0, Number(state?.lapses) || 0);

  let newEase = ease;
  let newReps = reps;
  let newInterval = prevInterval;
  let newLapses = lapses;

  // SM-2 ease delta: standard formula adapted to 0..3 scale
  // q=0 (again) → -0.30, q=1 (hard) → -0.15, q=2 (good) → 0, q=3 (easy) → +0.15
  const easeDelta = quality === 0 ? -0.30
                  : quality === 1 ? -0.15
                  : quality === 2 ? 0.0
                  : 0.15;
  newEase = clampEase(ease + easeDelta);

  if (quality === 0) {
    // Lapse: reset reps, schedule for next day
    newReps = 0;
    newLapses = lapses + 1;
    newInterval = 1;
  } else {
    newReps = reps + 1;
    if (newReps === 1) {
      newInterval = 1;
    } else if (newReps === 2) {
      newInterval = quality >= 3 ? 6 : 3;
    } else {
      // Subsequent reviews multiply by ease
      const multiplier = quality === 1 ? 1.2 : newEase;
      newInterval = Math.max(1, Math.round(prevInterval * multiplier));
    }
    // Cap interval at 365 days to bound storage growth
    newInterval = Math.min(365, newInterval);
  }

  const dueAt = new Date(Date.now() + newInterval * 86_400_000);

  return {
    easeFactor: round2(newEase),
    intervalDays: newInterval,
    repetitions: newReps,
    lapses: newLapses,
    dueAt,
  };
}

function clampEase(v) {
  if (Number.isNaN(v)) return EASE_DEFAULT;
  return Math.min(EASE_MAX, Math.max(EASE_MIN, v));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Parse a quality input — accepts string ("again"|"hard"|"good"|"easy") or
 * number 0..3. Returns null when input is invalid.
 */
function parseQuality(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string' && input in QUALITIES) return QUALITIES[input];
  const n = Number(input);
  if (Number.isInteger(n) && n >= 0 && n <= 3) return n;
  return null;
}

/**
 * Record an answer and update the review state.
 *
 * Maps the boolean correctness of an answer into a quality grade:
 *   correct + fast (< averageTime) → easy
 *   correct                        → good
 *   incorrect                      → again
 *
 * For explicit grading from a flashcard UI, prefer gradeReview() instead.
 *
 * @param {number} userId
 * @param {string} questionId
 * @param {boolean} isCorrect
 */
async function recordAnswer(userId, questionId, isCorrect) {
  if (!userId || !questionId) return null;
  const quality = isCorrect ? QUALITIES.good : QUALITIES.again;
  return _applyGrade(userId, questionId, quality);
}

/**
 * Explicit grading from the flashcard UI.
 *
 * @param {number} userId
 * @param {string} questionId
 * @param {number|string} qualityInput
 */
async function gradeReview(userId, questionId, qualityInput) {
  if (!userId || !questionId) {
    throw Object.assign(new Error('userId and questionId required'), { statusCode: 400 });
  }
  const quality = parseQuality(qualityInput);
  if (quality === null) {
    throw Object.assign(new Error('quality must be 0..3 or one of again/hard/good/easy'), { statusCode: 400 });
  }
  return _applyGrade(userId, questionId, quality);
}

async function _applyGrade(userId, questionId, quality) {
  try {
    // Fetch existing state (if any) and compute the next schedule
    const current = await pool.query(
      `SELECT ease_factor, interval_days, repetitions, lapses
         FROM question_reviews
        WHERE user_id = $1 AND question_id = $2`,
      [userId, questionId]
    );

    const state = current.rows[0] || {
      ease_factor: EASE_DEFAULT,
      interval_days: 0,
      repetitions: 0,
      lapses: 0,
    };

    const next = nextSchedule({
      easeFactor: state.ease_factor,
      intervalDays: state.interval_days,
      repetitions: state.repetitions,
      lapses: state.lapses,
    }, quality);

    const upsert = await pool.query(
      `INSERT INTO question_reviews
         (user_id, question_id, ease_factor, interval_days, repetitions, lapses,
          due_at, last_reviewed_at, last_quality, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, NOW(), NOW())
       ON CONFLICT (user_id, question_id) DO UPDATE SET
         ease_factor       = EXCLUDED.ease_factor,
         interval_days     = EXCLUDED.interval_days,
         repetitions       = EXCLUDED.repetitions,
         lapses            = EXCLUDED.lapses,
         due_at            = EXCLUDED.due_at,
         last_reviewed_at  = EXCLUDED.last_reviewed_at,
         last_quality      = EXCLUDED.last_quality,
         updated_at        = NOW()
       RETURNING *`,
      [
        userId,
        questionId,
        next.easeFactor,
        next.intervalDays,
        next.repetitions,
        next.lapses,
        next.dueAt,
        quality,
      ]
    );

    return _toApiShape(upsert.rows[0]);
  } catch (err) {
    logger.error('Failed to apply review grade:', err);
    throw err;
  }
}

/**
 * List the items due for review for a given user.
 *
 * @param {number} userId
 * @param {{ limit?: number, certificationId?: number, includeNew?: boolean }} [opts]
 * @returns {Promise<{ items: Array, total: number }>}
 */
async function getDueItems(userId, opts = {}) {
  if (!userId) return { items: [], total: 0 };
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 20, 1), 100);
  const certificationId = opts.certificationId != null
    ? parseInt(opts.certificationId, 10) : null;

  const params = [userId];
  let extraJoin = '';
  let extraWhere = '';
  if (certificationId) {
    extraJoin = 'JOIN topics t ON t.id = q.topic_id';
    extraWhere = 'AND t.certification_id = $2';
    params.push(certificationId);
  }
  params.push(limit);

  const result = await pool.query(
    `SELECT qr.question_id,
            qr.ease_factor, qr.interval_days, qr.repetitions, qr.lapses,
            qr.due_at, qr.last_reviewed_at, qr.last_quality,
            q.question_text, q.difficulty,
            t.name AS topic_name
       FROM question_reviews qr
       JOIN questions q ON q.id = qr.question_id
       LEFT JOIN topics t ON t.id = q.topic_id
       ${extraJoin}
      WHERE qr.user_id = $1
        AND qr.due_at <= NOW()
        ${extraWhere}
      ORDER BY qr.due_at ASC
      LIMIT $${params.length}`,
    params
  );

  const totalQ = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM question_reviews qr
       ${certificationId ? 'JOIN questions q ON q.id = qr.question_id JOIN topics t ON t.id = q.topic_id' : ''}
      WHERE qr.user_id = $1 AND qr.due_at <= NOW()
        ${extraWhere}`,
    certificationId ? [userId, certificationId] : [userId]
  );

  return {
    items: result.rows.map(_toApiShape),
    total: totalQ.rows[0]?.total || 0,
  };
}

/**
 * Quick count of items due today.
 *
 * @param {number} userId
 */
async function countDue(userId, certificationId = null) {
  if (!userId) return 0;
  const r = await pool.query(
    certificationId
      ? `SELECT COUNT(*)::int AS n
           FROM question_reviews qr
           JOIN questions q ON q.id = qr.question_id
           JOIN topics t ON t.id = q.topic_id
          WHERE qr.user_id = $1 AND qr.due_at <= NOW()
            AND t.certification_id = $2`
      : `SELECT COUNT(*)::int AS n
           FROM question_reviews
          WHERE user_id = $1 AND due_at <= NOW()`,
    certificationId ? [userId, certificationId] : [userId]
  );
  return r.rows[0]?.n || 0;
}

/**
 * Summary statistics for the current user (for headers / dashboards).
 *
 * @param {number} userId
 */
async function getStats(userId) {
  if (!userId) return null;
  const r = await pool.query(
    `SELECT
       COUNT(*)::int                                              AS total_cards,
       COUNT(*) FILTER (WHERE due_at <= NOW())::int               AS due_now,
       COUNT(*) FILTER (WHERE last_reviewed_at >= NOW() - INTERVAL '1 day')::int AS reviewed_24h,
       AVG(ease_factor)::float                                    AS avg_ease,
       SUM(lapses)::int                                           AS total_lapses
       FROM question_reviews
      WHERE user_id = $1`,
    [userId]
  );
  const row = r.rows[0] || {};
  return {
    totalCards: row.total_cards || 0,
    dueNow: row.due_now || 0,
    reviewed24h: row.reviewed_24h || 0,
    averageEase: row.avg_ease ? round2(row.avg_ease) : null,
    totalLapses: row.total_lapses || 0,
  };
}

function _toApiShape(row) {
  if (!row) return null;
  return {
    questionId: row.question_id,
    easeFactor: row.ease_factor,
    intervalDays: row.interval_days,
    repetitions: row.repetitions,
    lapses: row.lapses,
    dueAt: row.due_at,
    lastReviewedAt: row.last_reviewed_at,
    lastQuality: row.last_quality,
    ...(row.question_text != null && {
      questionText: row.question_text,
      difficulty: row.difficulty,
      topicName: row.topic_name,
    }),
  };
}

module.exports = {
  // Algorithm primitives (pure, easy to unit-test)
  nextSchedule,
  parseQuality,
  clampEase,
  QUALITIES,
  EASE_DEFAULT,
  EASE_MIN,
  EASE_MAX,
  // High-level API
  recordAnswer,
  gradeReview,
  getDueItems,
  countDue,
  getStats,
};
