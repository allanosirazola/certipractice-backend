/**
 * @fileoverview Progress Service
 *
 * User-facing engagement metrics:
 *  - Daily streak: consecutive days of activity (logins, exams, answers)
 *  - Readiness: estimated pass probability per certification based on
 *    recent performance vs. cert's passing threshold
 *
 * Both are read-only aggregates computed from existing telemetry tables
 * (`user_activity`, `exam_events`, `question_events`, `exams`).
 *
 * No new tables required.
 */

const pool = require('../database/pool');
const logger = require('../utils/logger');

/**
 * How many recent answers to consider for readiness.
 * Tradeoff: too few → noisy; too many → slow to react to study progress.
 */
const READINESS_WINDOW = 200;

/**
 * Minimum sample size for a meaningful readiness estimate.
 * Below this we return `null` instead of a misleading number.
 */
const READINESS_MIN_SAMPLES = 20;

/**
 * Buffer above passing score to call user "ready". 70% pass → 80% to feel safe.
 */
const READINESS_SAFETY_BUFFER = 10;

class ProgressService {
  // ─────────────────────────────────────────────────────────────────────
  // STREAK
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Get the user's daily activity streak.
   *
   * "Active" days are those where the user logged in, started/completed an
   * exam, or answered a question. We pull from `user_activity` + `exam_events`
   * + `question_events`.
   *
   * @param {number} userId
   * @returns {Promise<{
   *   currentStreak: number,
   *   longestStreak: number,
   *   lastActiveDate: string | null,   // YYYY-MM-DD (UTC)
   *   streakAtRisk: boolean,           // true if last activity was yesterday
   *   activeToday: boolean,
   * }>}
   */
  async getStreak(userId) {
    if (!userId) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: null,
        streakAtRisk: false,
        activeToday: false,
      };
    }

    // Pull distinct active days across all activity sources, last 365 days.
    // Using DATE_TRUNC('day', timestamp) at UTC for consistent boundaries.
    const sql = `
      WITH active_days AS (
        SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date AS day
        FROM user_activity
        WHERE user_id = $1
          AND created_at >= NOW() - INTERVAL '365 days'
        UNION
        SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date AS day
        FROM exam_events
        WHERE user_id = $1
          AND created_at >= NOW() - INTERVAL '365 days'
        UNION
        SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date AS day
        FROM question_events
        WHERE user_id = $1
          AND created_at >= NOW() - INTERVAL '365 days'
      )
      SELECT day FROM active_days ORDER BY day DESC
    `;
    let rows;
    try {
      const result = await pool.query(sql, [userId]);
      rows = result.rows;
    } catch (err) {
      logger.warn(`[progress] streak query failed: ${err.message}`);
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: null,
        streakAtRisk: false,
        activeToday: false,
      };
    }

    if (!rows.length) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: null,
        streakAtRisk: false,
        activeToday: false,
      };
    }

    const days = rows.map((r) => toDateKey(r.day));
    const todayUtc = toDateKey(new Date());
    const yesterdayUtc = toDateKey(new Date(Date.now() - 86400000));

    // Current streak: walk backwards from latest, allowing today OR yesterday
    // as the starting anchor (so users don't lose the streak if it's not yet
    // midnight UTC but they haven't logged in today).
    let currentStreak = 0;
    let cursor = null;

    if (days[0] === todayUtc) {
      cursor = new Date(`${todayUtc}T00:00:00Z`);
      currentStreak = 1;
    } else if (days[0] === yesterdayUtc) {
      cursor = new Date(`${yesterdayUtc}T00:00:00Z`);
      currentStreak = 1;
    }

    if (cursor) {
      for (let i = 1; i < days.length; i++) {
        const prev = new Date(cursor);
        prev.setUTCDate(prev.getUTCDate() - 1);
        const prevKey = toDateKey(prev);
        if (days[i] === prevKey) {
          currentStreak++;
          cursor = prev;
        } else {
          break;
        }
      }
    }

    // Longest streak: full pass over sorted days
    const longestStreak = computeLongestStreak(days);

    const lastActiveDate = days[0];
    const activeToday = lastActiveDate === todayUtc;
    const streakAtRisk = !activeToday && lastActiveDate === yesterdayUtc;

    return {
      currentStreak,
      longestStreak,
      lastActiveDate,
      streakAtRisk,
      activeToday,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // READINESS
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Estimate pass probability for a certification based on recent performance.
   *
   * Methodology:
   *  - Pull the last N answered questions for this user in this certification
   *  - Compute accuracy
   *  - Estimate probability via piecewise mapping vs passing_score:
   *      accuracy < passing                  → 0.0–0.5
   *      accuracy in [passing, passing+10]   → 0.5–0.85
   *      accuracy ≥ passing+10               → 0.85–0.99
   *  - Also report trend: is accuracy improving vs the older half?
   *
   * @param {number} userId
   * @param {number} certificationId
   * @returns {Promise<{
   *   ready: boolean,
   *   probability: number | null,       // 0..1, null if not enough samples
   *   accuracy: number | null,          // 0..100
   *   passingScore: number | null,
   *   samples: number,
   *   trend: 'improving'|'stable'|'declining'|null,
   *   recommendation: string,
   * }>}
   */
  async getReadiness(userId, certificationId) {
    if (!userId || !certificationId) {
      return this._readinessShell({ recommendation: 'invalid_input' });
    }

    // Get certification info
    let cert;
    try {
      const certRes = await pool.query(
        `SELECT id, name, passing_score FROM certifications WHERE id = $1`,
        [certificationId]
      );
      cert = certRes.rows[0];
    } catch (err) {
      logger.warn(`[progress] cert lookup failed: ${err.message}`);
      return this._readinessShell({ recommendation: 'cert_not_found' });
    }

    if (!cert) {
      return this._readinessShell({ recommendation: 'cert_not_found' });
    }

    const passingScore = cert.passing_score != null ? Number(cert.passing_score) : 70;

    // Pull last N answered questions in this cert via question_events
    let attempts;
    try {
      const result = await pool.query(
        `SELECT qe.is_correct, qe.created_at
         FROM question_events qe
         JOIN questions q ON q.id = qe.question_id
         JOIN topics t    ON t.id = q.topic_id
         WHERE qe.user_id = $1
           AND qe.event_type = 'answered'
           AND qe.is_correct IS NOT NULL
           AND t.certification_id = $2
         ORDER BY qe.created_at DESC
         LIMIT $3`,
        [userId, certificationId, READINESS_WINDOW]
      );
      attempts = result.rows;
    } catch (err) {
      logger.warn(`[progress] readiness query failed: ${err.message}`);
      return this._readinessShell({
        passingScore,
        recommendation: 'no_data',
      });
    }

    const samples = attempts.length;

    if (samples < READINESS_MIN_SAMPLES) {
      return this._readinessShell({
        passingScore,
        samples,
        recommendation: 'need_more_practice',
      });
    }

    const correct = attempts.filter((a) => a.is_correct === true).length;
    const accuracy = (correct / samples) * 100;

    // Probability mapping
    const probability = estimateProbability(accuracy, passingScore);

    // Trend: compare first half (older) vs second half (newer) of the window
    // attempts is DESC, so the "second half" is the newer (index 0..n/2)
    const half = Math.floor(samples / 2);
    const recentCorrect = attempts.slice(0, half).filter((a) => a.is_correct).length;
    const olderCorrect = attempts.slice(half).filter((a) => a.is_correct).length;
    const recentAcc = (recentCorrect / half) * 100;
    const olderAcc = (olderCorrect / (samples - half)) * 100;
    const trend = classifyTrend(recentAcc - olderAcc);

    const ready = probability >= 0.75 && accuracy >= (passingScore + READINESS_SAFETY_BUFFER);
    const recommendation = ready
      ? 'ready'
      : accuracy >= passingScore
        ? 'borderline'
        : 'keep_studying';

    return {
      ready,
      probability: round(probability, 2),
      accuracy: round(accuracy, 1),
      passingScore,
      samples,
      trend,
      recommendation,
      certificationId,
      certificationName: cert.name,
    };
  }

  _readinessShell({
    passingScore = null,
    samples = 0,
    trend = null,
    recommendation = 'no_data',
  } = {}) {
    return {
      ready: false,
      probability: null,
      accuracy: null,
      passingScore,
      samples,
      trend,
      recommendation,
    };
  }
}

// ─── helpers (kept outside class so they can be unit-tested) ─────────────

/**
 * Convert a Date (or date-like) to UTC YYYY-MM-DD string.
 * If given a string already in that shape, returns it unchanged.
 */
function toDateKey(d) {
  if (typeof d === 'string') return d.length >= 10 ? d.substring(0, 10) : d;
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().substring(0, 10);
}

/**
 * Walk through a sorted (DESC) list of day-strings and return the length
 * of the longest run of consecutive calendar days.
 */
function computeLongestStreak(daysDesc) {
  if (daysDesc.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < daysDesc.length; i++) {
    const prev = new Date(`${daysDesc[i - 1]}T00:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    const expected = toDateKey(prev);
    if (daysDesc[i] === expected) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest;
}

/**
 * Map (accuracy, passingScore) → probability in [0, 1].
 * Smoothly increases past the passing score.
 */
function estimateProbability(accuracy, passingScore) {
  if (accuracy < passingScore) {
    // 0..passing maps to 0..0.5
    return Math.max(0, (accuracy / passingScore) * 0.5);
  }
  const above = accuracy - passingScore;
  if (above <= 10) {
    // passing..passing+10 maps to 0.5..0.85
    return 0.5 + (above / 10) * 0.35;
  }
  // passing+10..100 maps to 0.85..0.99
  const remaining = 100 - (passingScore + 10);
  if (remaining <= 0) return 0.99;
  const extra = Math.min(above - 10, remaining);
  return 0.85 + (extra / remaining) * 0.14;
}

/**
 * Classify trend by accuracy delta (recent - older), in percentage points.
 *  > +3pp → improving
 *  < -3pp → declining
 *  otherwise → stable
 */
function classifyTrend(deltaPP) {
  if (deltaPP > 3) return 'improving';
  if (deltaPP < -3) return 'declining';
  return 'stable';
}

function round(n, digits = 2) {
  const m = Math.pow(10, digits);
  return Math.round(n * m) / m;
}

const instance = new ProgressService();

module.exports = instance;
module.exports.ProgressService = ProgressService;
module.exports.READINESS_WINDOW = READINESS_WINDOW;
module.exports.READINESS_MIN_SAMPLES = READINESS_MIN_SAMPLES;
module.exports.READINESS_SAFETY_BUFFER = READINESS_SAFETY_BUFFER;

// Internal helpers exposed for testing
module.exports._internals = {
  toDateKey,
  computeLongestStreak,
  estimateProbability,
  classifyTrend,
};
