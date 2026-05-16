/**
 * @fileoverview Study Plan Service
 *
 * A study plan ties a (user, certification) to a target exam date and
 * a daily question goal. Plans are computed at creation time; the
 * daily_goal stays fixed (the user committed to N questions/day) but
 * the progress (questions_answered) is updated periodically.
 *
 * Multiple plans per user are allowed (one per certification) but
 * only ONE is active per (user, certification) at a time. Creating a
 * new plan for the same cert soft-deactivates previous ones.
 */

const pool = require('../database/pool');
const logger = require('../utils/logger');

const MIN_GOAL = 5;
const MAX_GOAL = 100;
const MAX_HORIZON_DAYS = 365;

/**
 * Compute the suggested daily goal given days remaining.
 *
 * Rule of thumb:
 *   - < 7 days  → 30/day (cram)
 *   - 7-30 days → 20/day (standard prep)
 *   - 30-90 days → 15/day (steady)
 *   - 90+ days  → 10/day (light)
 *
 * Clamped to [MIN_GOAL, MAX_GOAL]. The user can override at creation,
 * we just hand them a sane default.
 *
 * @param {number} daysRemaining
 * @returns {number}
 */
function suggestDailyGoal(daysRemaining) {
  let goal;
  if (daysRemaining < 7) goal = 30;
  else if (daysRemaining < 30) goal = 20;
  else if (daysRemaining < 90) goal = 15;
  else goal = 10;
  return Math.min(MAX_GOAL, Math.max(MIN_GOAL, goal));
}

/** YYYY-MM-DD in UTC. */
function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Calendar days between two YYYY-MM-DD strings (target - today). */
function daysBetween(fromStr, toStr) {
  const ms = new Date(toStr + 'T00:00:00Z').getTime() - new Date(fromStr + 'T00:00:00Z').getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Create a study plan. Validates input, deactivates previous active
 * plans for the same (user, certification), and inserts the new row.
 *
 * @param {number} userId
 * @param {{ certificationId: number, targetDate: string, dailyGoal?: number }} payload
 * @returns {Promise<object>} the created plan row
 */
async function createPlan(userId, { certificationId, targetDate, dailyGoal }) {
  if (!userId) {
    throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  }
  if (!Number.isInteger(certificationId) || certificationId <= 0) {
    throw Object.assign(new Error('certificationId must be a positive integer'), { statusCode: 400 });
  }
  if (typeof targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw Object.assign(new Error('targetDate must be YYYY-MM-DD'), { statusCode: 400 });
  }

  const today = todayUtcDate();
  const horizon = daysBetween(today, targetDate);
  if (horizon < 1) {
    throw Object.assign(new Error('targetDate must be at least 1 day in the future'), { statusCode: 400 });
  }
  if (horizon > MAX_HORIZON_DAYS) {
    throw Object.assign(new Error(`targetDate must be within ${MAX_HORIZON_DAYS} days`), { statusCode: 400 });
  }

  let goal = Number.isInteger(dailyGoal) ? dailyGoal : suggestDailyGoal(horizon);
  goal = Math.min(MAX_GOAL, Math.max(MIN_GOAL, goal));

  try {
    // Deactivate previous active plans for the same (user, cert)
    await pool.query(
      `UPDATE study_plans
          SET is_active = FALSE, updated_at = NOW()
        WHERE user_id = $1 AND certification_id = $2 AND is_active = TRUE`,
      [userId, certificationId]
    );

    const result = await pool.query(
      `INSERT INTO study_plans
         (user_id, certification_id, target_date, daily_goal, questions_answered, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, TRUE, NOW(), NOW())
       RETURNING *`,
      [userId, certificationId, targetDate, goal]
    );
    return _toApi(result.rows[0]);
  } catch (err) {
    logger.error('createPlan failed:', err);
    throw err;
  }
}

/**
 * Get all active plans for a user, with computed progress fields.
 *
 * @param {number} userId
 */
async function listActivePlans(userId) {
  if (!userId) return [];

  // Fetch active plans
  const plans = await pool.query(
    `SELECT sp.*, c.name AS certification_name, c.code AS certification_code
       FROM study_plans sp
       JOIN certifications c ON c.id = sp.certification_id
      WHERE sp.user_id = $1 AND sp.is_active = TRUE
      ORDER BY sp.target_date ASC`,
    [userId]
  );
  if (plans.rowCount === 0) return [];

  // Fold in answered counts per certification since plan creation
  const answeredByCert = await _getAnsweredCountsSince(userId, plans.rows);

  return plans.rows.map((row) => _toApi(row, answeredByCert[row.id]));
}

/**
 * Single-certification helper: returns the user's active plan for the
 * given certification, or null. Convenient for the per-cert UI gauge.
 */
async function getActivePlanForCertification(userId, certificationId) {
  if (!userId) return null;
  if (!Number.isInteger(certificationId)) return null;
  const result = await pool.query(
    `SELECT sp.*, c.name AS certification_name, c.code AS certification_code
       FROM study_plans sp
       JOIN certifications c ON c.id = sp.certification_id
      WHERE sp.user_id = $1 AND sp.certification_id = $2 AND sp.is_active = TRUE
      LIMIT 1`,
    [userId, certificationId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const answered = await _getAnsweredCountsSince(userId, [row]);
  return _toApi(row, answered[row.id]);
}

/**
 * Soft-cancel an active plan (set isActive=false).
 *
 * @param {number} userId
 * @param {number|string} planId
 */
async function cancelPlan(userId, planId) {
  if (!userId) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  const id = Number(planId);
  if (!Number.isFinite(id) || id <= 0) {
    throw Object.assign(new Error('planId must be a positive number'), { statusCode: 400 });
  }
  const result = await pool.query(
    `UPDATE study_plans
        SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND is_active = TRUE
      RETURNING id`,
    [id, userId]
  );
  return { cancelled: result.rowCount > 0 };
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

/**
 * For each plan row, count exam_answers belonging to that user since
 * the plan's created_at, scoped to questions whose topic belongs to
 * the plan's certification. Cheap aggregation in a single query.
 *
 * @returns {Promise<Record<string|number, number>>} plan.id → count
 */
async function _getAnsweredCountsSince(userId, plans) {
  if (!plans || plans.length === 0) return {};
  const out = {};
  // Per-plan to keep the SQL straightforward — there's usually at
  // most a handful of active plans per user.
  for (const plan of plans) {
    try {
      const r = await pool.query(
        `SELECT COUNT(DISTINCT ea.id)::int AS n
           FROM exam_answers ea
           JOIN exams       e ON e.id = ea.exam_id
           JOIN questions   q ON q.id = ea.question_id
           JOIN topics      t ON t.id = q.topic_id
          WHERE e.user_id = $1
            AND t.certification_id = $2
            AND ea.created_at >= $3`,
        [userId, plan.certification_id, plan.created_at]
      );
      out[plan.id] = r.rows[0]?.n || 0;
    } catch (err) {
      logger.warn('answered-count query failed for plan', plan.id, err?.message);
      out[plan.id] = 0;
    }
  }
  return out;
}

/** Camel-case + computed fields for the API response. */
function _toApi(row, answeredSinceCreation = null) {
  if (!row) return null;
  const today = todayUtcDate();
  const targetIso = row.target_date instanceof Date
    ? row.target_date.toISOString().slice(0, 10)
    : String(row.target_date).slice(0, 10);
  const daysRemaining = Math.max(0, daysBetween(today, targetIso));
  const answered = answeredSinceCreation != null
    ? answeredSinceCreation
    : (row.questions_answered || 0);

  const createdIso = row.created_at instanceof Date
    ? row.created_at.toISOString().slice(0, 10)
    : String(row.created_at).slice(0, 10);
  const elapsedDays = Math.max(1, daysBetween(createdIso, today) + 1);
  const expectedSoFar = elapsedDays * (row.daily_goal || 0);
  const onTrack = answered >= expectedSoFar * 0.9; // 10% grace

  return {
    id: typeof row.id === 'bigint' ? row.id.toString() : row.id,
    certificationId: row.certification_id,
    certificationName: row.certification_name,
    certificationCode: row.certification_code,
    targetDate: targetIso,
    dailyGoal: row.daily_goal,
    questionsAnswered: answered,
    daysRemaining,
    elapsedDays,
    expectedSoFar,
    onTrack,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

module.exports = {
  createPlan,
  listActivePlans,
  getActivePlanForCertification,
  cancelPlan,
  // Pure helpers exported for tests
  _internals: { suggestDailyGoal, daysBetween, todayUtcDate },
};
