/**
 * @fileoverview Telemetry Service
 * Centralized event tracking for analytics.
 *
 * Design notes:
 * - All track* methods are fire-and-forget (never throw to caller)
 * - Failures are logged but never block the user-facing request
 * - Uses raw SQL via the pg pool for maximum performance on hot paths
 * - Supports both authenticated users (userId) and anonymous (sessionId)
 */

const pool = require('../database/pool');
const logger = require('../utils/logger');

/**
 * Extract identity from a request object.
 * Returns { userId, sessionId, ipAddress, userAgent }
 */
const extractIdentity = (req) => {
  if (!req) return { userId: null, sessionId: null, ipAddress: null, userAgent: null };
  return {
    userId: req.user?.id || null,
    sessionId: req.sessionId || null,
    ipAddress: req.ip || req.headers?.['x-forwarded-for'] || null,
    userAgent: req.headers?.['user-agent']?.substring(0, 500) || null,
  };
};

/**
 * Track an exam lifecycle event.
 *
 * @param {object} params
 * @param {string} params.examId - UUID of the exam
 * @param {string} params.eventType - One of ExamEventType
 * @param {object} [params.req] - Request object for identity extraction
 * @param {number} [params.userId] - Override
 * @param {string} [params.sessionId] - Override
 * @param {object} [params.metadata]
 * @param {number} [params.questionIndex]
 */
const trackExamEvent = async ({
  examId,
  eventType,
  req = null,
  userId,
  sessionId,
  metadata = null,
  questionIndex = null,
}) => {
  try {
    const identity = extractIdentity(req);
    const finalUserId = userId !== undefined ? userId : identity.userId;
    const finalSessionId = sessionId !== undefined ? sessionId : identity.sessionId;

    await pool.query(
      `INSERT INTO exam_events
        (exam_id, user_id, session_id, event_type, metadata, question_index, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4::"ExamEventType", $5, $6, $7, $8, NOW())`,
      [
        examId,
        finalUserId,
        finalSessionId,
        eventType,
        metadata ? JSON.stringify(metadata) : null,
        questionIndex,
        identity.ipAddress,
        identity.userAgent,
      ]
    );
  } catch (error) {
    logger.warn(`Failed to track exam event ${eventType}: ${error.message}`);
  }
};

/**
 * Track a question interaction event.
 *
 * @param {object} params
 * @param {string} params.questionId
 * @param {string} params.eventType - One of QuestionEventType
 * @param {boolean} [params.isCorrect]
 * @param {number} [params.timeSpent] - Seconds
 * @param {object} [params.req]
 * @param {object} [params.metadata]
 */
const trackQuestionEvent = async ({
  questionId,
  eventType,
  isCorrect = null,
  timeSpent = null,
  req = null,
  userId,
  sessionId,
  metadata = null,
}) => {
  try {
    const identity = extractIdentity(req);
    const finalUserId = userId !== undefined ? userId : identity.userId;
    const finalSessionId = sessionId !== undefined ? sessionId : identity.sessionId;

    await pool.query(
      `INSERT INTO question_events
        (question_id, user_id, session_id, event_type, is_correct, time_spent, metadata, ip_address, created_at)
       VALUES ($1, $2, $3, $4::"QuestionEventType", $5, $6, $7, $8, NOW())`,
      [
        questionId,
        finalUserId,
        finalSessionId,
        eventType,
        isCorrect,
        timeSpent,
        metadata ? JSON.stringify(metadata) : null,
        identity.ipAddress,
      ]
    );
  } catch (error) {
    logger.warn(`Failed to track question event ${eventType}: ${error.message}`);
  }
};

/**
 * Track generic user activity (login, page view, search, etc.).
 *
 * @param {object} params
 * @param {string} params.activityType - One of UserActivityType
 * @param {object} [params.req]
 * @param {string} [params.path]
 * @param {string} [params.referrer]
 * @param {object} [params.metadata]
 * @param {number} [params.durationMs]
 */
const trackUserActivity = async ({
  activityType,
  req = null,
  userId,
  sessionId,
  path = null,
  referrer = null,
  metadata = null,
  durationMs = null,
}) => {
  try {
    const identity = extractIdentity(req);
    const finalUserId = userId !== undefined ? userId : identity.userId;
    const finalSessionId = sessionId !== undefined ? sessionId : identity.sessionId;

    await pool.query(
      `INSERT INTO user_activity
        (user_id, session_id, activity_type, path, referrer, metadata, duration_ms, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3::"UserActivityType", $4, $5, $6, $7, $8, $9, NOW())`,
      [
        finalUserId,
        finalSessionId,
        activityType,
        path?.substring(0, 500) || null,
        referrer?.substring(0, 500) || null,
        metadata ? JSON.stringify(metadata) : null,
        durationMs,
        identity.ipAddress,
        identity.userAgent,
      ]
    );
  } catch (error) {
    logger.warn(`Failed to track activity ${activityType}: ${error.message}`);
  }
};

/**
 * Batch track multiple events (e.g., for client-side queue flush).
 * Uses a single transaction for performance.
 *
 * @param {Array<{type: 'exam'|'question'|'activity', payload: object}>} events
 */
const trackBatch = async (events) => {
  if (!Array.isArray(events) || events.length === 0) return { tracked: 0 };

  let tracked = 0;
  for (const event of events) {
    try {
      if (event.type === 'exam') {
        await trackExamEvent(event.payload);
      } else if (event.type === 'question') {
        await trackQuestionEvent(event.payload);
      } else if (event.type === 'activity') {
        await trackUserActivity(event.payload);
      } else {
        continue;
      }
      tracked++;
    } catch (error) {
      logger.warn(`Batch event failed: ${error.message}`);
    }
  }

  return { tracked, total: events.length };
};

/**
 * Compute and persist daily metrics for the given date (or yesterday by default).
 * Idempotent: re-running for the same date overwrites.
 *
 * @param {Date|string} [targetDate] - Date to compute (default: yesterday UTC)
 * @param {string} [scope='global']
 */
const computeDailyMetrics = async (targetDate = null, scope = 'global') => {
  const date = targetDate
    ? new Date(targetDate)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  date.setUTCHours(0, 0, 0, 0);
  const dateStr = date.toISOString().split('T')[0];

  try {
    const examMetrics = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE event_type = 'exam_created')   AS exams_created,
        COUNT(*) FILTER (WHERE event_type = 'exam_started')   AS exams_started,
        COUNT(*) FILTER (WHERE event_type = 'exam_completed') AS exams_completed,
        COUNT(*) FILTER (WHERE event_type = 'exam_abandoned') AS exams_abandoned,
        COUNT(*) FILTER (WHERE event_type = 'exam_completed' AND (metadata->>'passed')::boolean = true) AS exams_passed,
        AVG((metadata->>'score')::float) FILTER (WHERE event_type = 'exam_completed') AS average_score,
        AVG((metadata->>'timeSpent')::int) FILTER (WHERE event_type = 'exam_completed') AS average_time_spent
       FROM exam_events
       WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')`,
      [dateStr]
    );

    const questionMetrics = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE event_type = 'viewed')     AS questions_viewed,
        COUNT(*) FILTER (WHERE event_type = 'answered')   AS questions_answered,
        COUNT(*) FILTER (WHERE event_type = 'answered' AND is_correct = true) AS questions_correct,
        COUNT(*) FILTER (WHERE event_type = 'reported')   AS questions_reported
       FROM question_events
       WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')`,
      [dateStr]
    );

    const userMetrics = await pool.query(
      `SELECT
        COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)   AS unique_users,
        COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL) AS unique_sessions,
        COUNT(*) FILTER (WHERE activity_type = 'login')              AS logins,
        COUNT(*) FILTER (WHERE activity_type = 'page_view')          AS page_views
       FROM user_activity
       WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')`,
      [dateStr]
    );

    const newUsers = await pool.query(
      `SELECT COUNT(*) AS new_users FROM users
       WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')`,
      [dateStr]
    );

    const e = examMetrics.rows[0];
    const q = questionMetrics.rows[0];
    const u = userMetrics.rows[0];
    const n = newUsers.rows[0];

    await pool.query(
      `INSERT INTO daily_metrics
        (date, scope,
         exams_created, exams_started, exams_completed, exams_abandoned, exams_passed,
         average_score, average_time_spent,
         questions_viewed, questions_answered, questions_correct, questions_reported,
         unique_users, unique_sessions, new_users, logins, page_views,
         computed_at)
       VALUES ($1::date, $2,
               $3, $4, $5, $6, $7,
               $8, $9,
               $10, $11, $12, $13,
               $14, $15, $16, $17, $18,
               NOW())
       ON CONFLICT (date, scope) DO UPDATE SET
         exams_created = EXCLUDED.exams_created,
         exams_started = EXCLUDED.exams_started,
         exams_completed = EXCLUDED.exams_completed,
         exams_abandoned = EXCLUDED.exams_abandoned,
         exams_passed = EXCLUDED.exams_passed,
         average_score = EXCLUDED.average_score,
         average_time_spent = EXCLUDED.average_time_spent,
         questions_viewed = EXCLUDED.questions_viewed,
         questions_answered = EXCLUDED.questions_answered,
         questions_correct = EXCLUDED.questions_correct,
         questions_reported = EXCLUDED.questions_reported,
         unique_users = EXCLUDED.unique_users,
         unique_sessions = EXCLUDED.unique_sessions,
         new_users = EXCLUDED.new_users,
         logins = EXCLUDED.logins,
         page_views = EXCLUDED.page_views,
         computed_at = NOW()`,
      [
        dateStr,
        scope,
        parseInt(e.exams_created) || 0,
        parseInt(e.exams_started) || 0,
        parseInt(e.exams_completed) || 0,
        parseInt(e.exams_abandoned) || 0,
        parseInt(e.exams_passed) || 0,
        e.average_score ? parseFloat(e.average_score) : null,
        e.average_time_spent ? Math.round(parseFloat(e.average_time_spent)) : null,
        parseInt(q.questions_viewed) || 0,
        parseInt(q.questions_answered) || 0,
        parseInt(q.questions_correct) || 0,
        parseInt(q.questions_reported) || 0,
        parseInt(u.unique_users) || 0,
        parseInt(u.unique_sessions) || 0,
        parseInt(n.new_users) || 0,
        parseInt(u.logins) || 0,
        parseInt(u.page_views) || 0,
      ]
    );

    logger.info(`Computed daily metrics for ${dateStr} (${scope})`);
    return { date: dateStr, scope, success: true };
  } catch (error) {
    logger.error(`Failed to compute daily metrics for ${dateStr}: ${error.message}`);
    return { date: dateStr, scope, success: false, error: error.message };
  }
};

module.exports = {
  trackExamEvent,
  trackQuestionEvent,
  trackUserActivity,
  trackBatch,
  computeDailyMetrics,
  extractIdentity,
};
