/**
 * @fileoverview Admin Analytics Controller
 * Aggregated dashboards for understanding user behavior.
 *
 * Endpoints under /api/admin/analytics:
 * - /overview        — KPIs summary (last 7/30 days)
 * - /exams           — Exam funnel: created → started → completed → passed
 * - /questions       — Most failed/viewed/reported questions
 * - /users           — Active users, retention, sessions
 * - /funnel          — Page-view funnel, drop-off
 * - /timeseries      — Daily metrics over a range
 */

const pool = require('../database/pool');
const logger = require('../utils/logger');
const telemetryService = require('../services/telemetryService');

/**
 * Parse and validate ?days= query (default 7, max 365)
 */
const parseDaysRange = (req) => {
  const raw = parseInt(req.query.days, 10);
  if (Number.isNaN(raw) || raw < 1) return 7;
  return Math.min(raw, 365);
};

/**
 * GET /overview — High-level KPIs summary
 */
const getOverview = async (req, res) => {
  try {
    const days = parseDaysRange(req);
    const intervalSql = `INTERVAL '${days} days'`;

    const [examsRes, questionsRes, usersRes, comparison] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'exam_created')   AS created,
           COUNT(*) FILTER (WHERE event_type = 'exam_started')   AS started,
           COUNT(*) FILTER (WHERE event_type = 'exam_completed') AS completed,
           COUNT(*) FILTER (WHERE event_type = 'exam_abandoned') AS abandoned,
           COUNT(*) FILTER (WHERE event_type = 'exam_completed' AND (metadata->>'passed')::boolean = true) AS passed,
           AVG((metadata->>'score')::float) FILTER (WHERE event_type = 'exam_completed') AS avg_score,
           AVG((metadata->>'timeSpent')::int) FILTER (WHERE event_type = 'exam_completed') AS avg_time_seconds
         FROM exam_events
         WHERE created_at >= NOW() - ${intervalSql}`
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'viewed')   AS views,
           COUNT(*) FILTER (WHERE event_type = 'answered') AS answered,
           COUNT(*) FILTER (WHERE event_type = 'answered' AND is_correct = true) AS correct,
           COUNT(DISTINCT question_id)                     AS unique_questions
         FROM question_events
         WHERE created_at >= NOW() - ${intervalSql}`
      ),
      pool.query(
        `SELECT
           COUNT(DISTINCT user_id)    FILTER (WHERE user_id IS NOT NULL)    AS active_users,
           COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL) AS active_sessions,
           COUNT(*) FILTER (WHERE activity_type = 'login')                  AS logins,
           COUNT(*) FILTER (WHERE activity_type = 'registration')           AS registrations,
           COUNT(*) FILTER (WHERE activity_type = 'page_view')              AS page_views
         FROM user_activity
         WHERE created_at >= NOW() - ${intervalSql}`
      ),
      // Previous period for comparison
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'exam_completed') AS prev_completed,
           COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS prev_users
         FROM exam_events
         WHERE created_at >= NOW() - ${intervalSql} - ${intervalSql}
           AND created_at <  NOW() - ${intervalSql}`
      ),
    ]);

    const e = examsRes.rows[0];
    const q = questionsRes.rows[0];
    const u = usersRes.rows[0];
    const prev = comparison.rows[0];

    const completionRate = e.started > 0
      ? Math.round((parseInt(e.completed) / parseInt(e.started)) * 100)
      : 0;
    const passRate = e.completed > 0
      ? Math.round((parseInt(e.passed) / parseInt(e.completed)) * 100)
      : 0;
    const accuracyRate = q.answered > 0
      ? Math.round((parseInt(q.correct) / parseInt(q.answered)) * 100)
      : 0;

    const completedDelta = prev.prev_completed > 0
      ? Math.round(((parseInt(e.completed) - parseInt(prev.prev_completed)) / parseInt(prev.prev_completed)) * 100)
      : null;

    res.json({
      success: true,
      data: {
        period: { days, generatedAt: new Date().toISOString() },
        exams: {
          created: parseInt(e.created) || 0,
          started: parseInt(e.started) || 0,
          completed: parseInt(e.completed) || 0,
          abandoned: parseInt(e.abandoned) || 0,
          passed: parseInt(e.passed) || 0,
          completionRate,
          passRate,
          averageScore: e.avg_score ? Math.round(parseFloat(e.avg_score) * 10) / 10 : null,
          averageTimeMinutes: e.avg_time_seconds ? Math.round(parseFloat(e.avg_time_seconds) / 60) : null,
          completedDeltaPercent: completedDelta,
        },
        questions: {
          views: parseInt(q.views) || 0,
          answered: parseInt(q.answered) || 0,
          correct: parseInt(q.correct) || 0,
          accuracyRate,
          uniqueQuestionsTouched: parseInt(q.unique_questions) || 0,
        },
        users: {
          activeUsers: parseInt(u.active_users) || 0,
          activeSessions: parseInt(u.active_sessions) || 0,
          logins: parseInt(u.logins) || 0,
          registrations: parseInt(u.registrations) || 0,
          pageViews: parseInt(u.page_views) || 0,
        },
      },
    });
  } catch (error) {
    logger.error('Overview analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to compute overview' });
  }
};

/**
 * GET /exams — Exam funnel and breakdown
 */
const getExamAnalytics = async (req, res) => {
  try {
    const days = parseDaysRange(req);
    const intervalSql = `INTERVAL '${days} days'`;

    const [funnel, byStatus, byMode, abandonReasons, slowestExams] = await Promise.all([
      // Daily funnel
      pool.query(
        `SELECT
           DATE_TRUNC('day', created_at)::date AS day,
           COUNT(*) FILTER (WHERE event_type = 'exam_created')   AS created,
           COUNT(*) FILTER (WHERE event_type = 'exam_started')   AS started,
           COUNT(*) FILTER (WHERE event_type = 'exam_completed') AS completed,
           COUNT(*) FILTER (WHERE event_type = 'exam_abandoned') AS abandoned
         FROM exam_events
         WHERE created_at >= NOW() - ${intervalSql}
         GROUP BY day
         ORDER BY day`
      ),
      // Status distribution from exams table
      pool.query(
        `SELECT status, COUNT(*) AS count
         FROM exams
         WHERE created_at >= NOW() - ${intervalSql}
         GROUP BY status`
      ),
      // Mode breakdown
      pool.query(
        `SELECT mode, COUNT(*) AS count, AVG(score) FILTER (WHERE status = 'completed') AS avg_score
         FROM exams
         WHERE created_at >= NOW() - ${intervalSql}
         GROUP BY mode`
      ),
      // Where users abandon (which question index)
      pool.query(
        `SELECT
           question_index,
           COUNT(*) AS abandonments
         FROM exam_events
         WHERE event_type = 'exam_abandoned'
           AND created_at >= NOW() - ${intervalSql}
           AND question_index IS NOT NULL
         GROUP BY question_index
         ORDER BY abandonments DESC
         LIMIT 20`
      ),
      // Slowest completed exams (potential UX issue)
      pool.query(
        `SELECT
           exam_id,
           AVG((metadata->>'timeSpent')::int) AS avg_time_seconds,
           COUNT(*) AS completions
         FROM exam_events
         WHERE event_type = 'exam_completed'
           AND created_at >= NOW() - ${intervalSql}
           AND metadata->>'timeSpent' IS NOT NULL
         GROUP BY exam_id
         ORDER BY avg_time_seconds DESC
         LIMIT 10`
      ),
    ]);

    res.json({
      success: true,
      data: {
        period: { days, generatedAt: new Date().toISOString() },
        dailyFunnel: funnel.rows.map((r) => ({
          day: r.day,
          created: parseInt(r.created) || 0,
          started: parseInt(r.started) || 0,
          completed: parseInt(r.completed) || 0,
          abandoned: parseInt(r.abandoned) || 0,
        })),
        statusDistribution: byStatus.rows.map((r) => ({
          status: r.status,
          count: parseInt(r.count),
        })),
        byMode: byMode.rows.map((r) => ({
          mode: r.mode,
          count: parseInt(r.count),
          averageScore: r.avg_score ? Math.round(parseFloat(r.avg_score) * 10) / 10 : null,
        })),
        abandonmentByQuestionIndex: abandonReasons.rows.map((r) => ({
          questionIndex: r.question_index,
          abandonments: parseInt(r.abandonments),
        })),
        slowestExams: slowestExams.rows.map((r) => ({
          examId: r.exam_id,
          averageTimeMinutes: Math.round(parseFloat(r.avg_time_seconds) / 60),
          completions: parseInt(r.completions),
        })),
      },
    });
  } catch (error) {
    logger.error('Exam analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to compute exam analytics' });
  }
};

/**
 * GET /questions — Question performance analytics
 */
const getQuestionAnalytics = async (req, res) => {
  try {
    const days = parseDaysRange(req);
    const intervalSql = `INTERVAL '${days} days'`;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const [mostFailed, mostViewed, mostReported, accuracyBuckets, byDifficulty] = await Promise.all([
      // Most failed questions (highest fail rate among answered)
      pool.query(
        `SELECT
           qe.question_id,
           q.question_text,
           q.difficulty_level,
           t.name AS topic_name,
           c.name AS certification_name,
           COUNT(*) FILTER (WHERE qe.event_type = 'answered') AS attempts,
           COUNT(*) FILTER (WHERE qe.event_type = 'answered' AND qe.is_correct = false) AS failures,
           ROUND(
             100.0 * COUNT(*) FILTER (WHERE qe.event_type = 'answered' AND qe.is_correct = false)
             / NULLIF(COUNT(*) FILTER (WHERE qe.event_type = 'answered'), 0)
           , 1) AS fail_rate
         FROM question_events qe
         JOIN questions q ON qe.question_id = q.id
         LEFT JOIN topics t ON q.topic_id = t.id
         LEFT JOIN certifications c ON t.certification_id = c.id
         WHERE qe.created_at >= NOW() - ${intervalSql}
         GROUP BY qe.question_id, q.question_text, q.difficulty_level, t.name, c.name
         HAVING COUNT(*) FILTER (WHERE qe.event_type = 'answered') >= 5
         ORDER BY fail_rate DESC, attempts DESC
         LIMIT $1`,
        [limit]
      ),
      // Most viewed questions
      pool.query(
        `SELECT
           qe.question_id,
           q.question_text,
           t.name AS topic_name,
           COUNT(*) AS views
         FROM question_events qe
         JOIN questions q ON qe.question_id = q.id
         LEFT JOIN topics t ON q.topic_id = t.id
         WHERE qe.event_type = 'viewed'
           AND qe.created_at >= NOW() - ${intervalSql}
         GROUP BY qe.question_id, q.question_text, t.name
         ORDER BY views DESC
         LIMIT $1`,
        [limit]
      ),
      // Most reported questions
      pool.query(
        `SELECT
           qe.question_id,
           q.question_text,
           COUNT(*) AS reports
         FROM question_events qe
         JOIN questions q ON qe.question_id = q.id
         WHERE qe.event_type = 'reported'
           AND qe.created_at >= NOW() - ${intervalSql}
         GROUP BY qe.question_id, q.question_text
         ORDER BY reports DESC
         LIMIT $1`,
        [limit]
      ),
      // Accuracy buckets distribution
      pool.query(
        `WITH question_accuracy AS (
           SELECT
             question_id,
             COUNT(*) FILTER (WHERE is_correct = true)::float
               / NULLIF(COUNT(*), 0) AS accuracy
           FROM question_events
           WHERE event_type = 'answered'
             AND created_at >= NOW() - ${intervalSql}
           GROUP BY question_id
           HAVING COUNT(*) >= 5
         )
         SELECT
           CASE
             WHEN accuracy < 0.25 THEN '0-25%'
             WHEN accuracy < 0.50 THEN '25-50%'
             WHEN accuracy < 0.75 THEN '50-75%'
             ELSE '75-100%'
           END AS bucket,
           COUNT(*) AS questions
         FROM question_accuracy
         GROUP BY bucket
         ORDER BY bucket`
      ),
      // Performance by difficulty
      pool.query(
        `SELECT
           q.difficulty_level,
           COUNT(*) FILTER (WHERE qe.event_type = 'answered') AS attempts,
           ROUND(
             100.0 * COUNT(*) FILTER (WHERE qe.event_type = 'answered' AND qe.is_correct = true)
             / NULLIF(COUNT(*) FILTER (WHERE qe.event_type = 'answered'), 0)
           , 1) AS accuracy_rate,
           AVG(qe.time_spent) FILTER (WHERE qe.event_type = 'answered') AS avg_time_seconds
         FROM question_events qe
         JOIN questions q ON qe.question_id = q.id
         WHERE qe.created_at >= NOW() - ${intervalSql}
         GROUP BY q.difficulty_level
         ORDER BY
           CASE q.difficulty_level
             WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 WHEN 'hard' THEN 3 WHEN 'expert' THEN 4
           END`
      ),
    ]);

    const truncateText = (text, max = 120) =>
      text && text.length > max ? text.substring(0, max) + '…' : text;

    res.json({
      success: true,
      data: {
        period: { days, generatedAt: new Date().toISOString() },
        mostFailedQuestions: mostFailed.rows.map((r) => ({
          questionId: r.question_id,
          preview: truncateText(r.question_text),
          difficulty: r.difficulty_level,
          topicName: r.topic_name,
          certificationName: r.certification_name,
          attempts: parseInt(r.attempts),
          failures: parseInt(r.failures),
          failRate: parseFloat(r.fail_rate),
        })),
        mostViewedQuestions: mostViewed.rows.map((r) => ({
          questionId: r.question_id,
          preview: truncateText(r.question_text),
          topicName: r.topic_name,
          views: parseInt(r.views),
        })),
        mostReportedQuestions: mostReported.rows.map((r) => ({
          questionId: r.question_id,
          preview: truncateText(r.question_text),
          reports: parseInt(r.reports),
        })),
        accuracyDistribution: accuracyBuckets.rows.map((r) => ({
          bucket: r.bucket,
          questions: parseInt(r.questions),
        })),
        byDifficulty: byDifficulty.rows.map((r) => ({
          difficulty: r.difficulty_level,
          attempts: parseInt(r.attempts) || 0,
          accuracyRate: r.accuracy_rate ? parseFloat(r.accuracy_rate) : null,
          averageTimeSeconds: r.avg_time_seconds ? Math.round(parseFloat(r.avg_time_seconds)) : null,
        })),
      },
    });
  } catch (error) {
    logger.error('Question analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to compute question analytics' });
  }
};

/**
 * GET /users — User behavior, retention, sessions
 */
const getUserAnalytics = async (req, res) => {
  try {
    const days = parseDaysRange(req);
    const intervalSql = `INTERVAL '${days} days'`;

    const [dau, registrations, topUsers, sessionMetrics, anonymousVsAuth] = await Promise.all([
      // Daily active users
      pool.query(
        `SELECT
           DATE_TRUNC('day', created_at)::date AS day,
           COUNT(DISTINCT user_id)    FILTER (WHERE user_id IS NOT NULL)    AS dau,
           COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL) AS anon_sessions
         FROM user_activity
         WHERE created_at >= NOW() - ${intervalSql}
         GROUP BY day
         ORDER BY day`
      ),
      // Registrations per day
      pool.query(
        `SELECT
           DATE_TRUNC('day', created_at)::date AS day,
           COUNT(*) AS registrations
         FROM users
         WHERE created_at >= NOW() - ${intervalSql}
         GROUP BY day
         ORDER BY day`
      ),
      // Most active users
      pool.query(
        `SELECT
           u.id,
           u.username,
           u.email,
           COUNT(DISTINCT ua.id) AS activities,
           COUNT(DISTINCT ua.id) FILTER (WHERE ua.activity_type = 'page_view') AS page_views,
           COUNT(DISTINCT ee.id) FILTER (WHERE ee.event_type = 'exam_completed') AS exams_completed
         FROM users u
         LEFT JOIN user_activity ua ON ua.user_id = u.id AND ua.created_at >= NOW() - ${intervalSql}
         LEFT JOIN exam_events  ee ON ee.user_id = u.id AND ee.created_at >= NOW() - ${intervalSql}
         GROUP BY u.id, u.username, u.email
         HAVING COUNT(DISTINCT ua.id) > 0
         ORDER BY activities DESC
         LIMIT 20`
      ),
      // Session length stats
      pool.query(
        `SELECT
           AVG(duration_ms)::int AS avg_duration_ms,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS median_duration_ms,
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms
         FROM user_activity
         WHERE activity_type = 'page_view'
           AND duration_ms IS NOT NULL
           AND duration_ms < 60000
           AND created_at >= NOW() - ${intervalSql}`
      ),
      // Anonymous vs authenticated split
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE user_id IS NOT NULL) AS authenticated,
           COUNT(*) FILTER (WHERE user_id IS NULL AND session_id IS NOT NULL) AS anonymous
         FROM user_activity
         WHERE created_at >= NOW() - ${intervalSql}`
      ),
    ]);

    const auth = anonymousVsAuth.rows[0];
    const sm = sessionMetrics.rows[0];

    res.json({
      success: true,
      data: {
        period: { days, generatedAt: new Date().toISOString() },
        dailyActiveUsers: dau.rows.map((r) => ({
          day: r.day,
          authenticatedUsers: parseInt(r.dau) || 0,
          anonymousSessions: parseInt(r.anon_sessions) || 0,
        })),
        registrationsByDay: registrations.rows.map((r) => ({
          day: r.day,
          registrations: parseInt(r.registrations),
        })),
        mostActiveUsers: topUsers.rows.map((r) => ({
          userId: r.id,
          username: r.username,
          email: r.email,
          activities: parseInt(r.activities),
          pageViews: parseInt(r.page_views) || 0,
          examsCompleted: parseInt(r.exams_completed) || 0,
        })),
        pageViewDuration: {
          averageMs: sm.avg_duration_ms ? parseInt(sm.avg_duration_ms) : null,
          medianMs: sm.median_duration_ms ? parseInt(sm.median_duration_ms) : null,
          p95Ms: sm.p95_duration_ms ? parseInt(sm.p95_duration_ms) : null,
        },
        userSplit: {
          authenticated: parseInt(auth.authenticated) || 0,
          anonymous: parseInt(auth.anonymous) || 0,
        },
      },
    });
  } catch (error) {
    logger.error('User analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to compute user analytics' });
  }
};

/**
 * GET /funnel — Page-view funnel and most-visited paths
 */
const getFunnel = async (req, res) => {
  try {
    const days = parseDaysRange(req);
    const intervalSql = `INTERVAL '${days} days'`;

    const [topPaths, errors, searchQueries] = await Promise.all([
      // Most visited paths
      pool.query(
        `SELECT
           path,
           COUNT(*) AS visits,
           COUNT(DISTINCT COALESCE(user_id::text, session_id)) AS unique_visitors,
           AVG(duration_ms)::int AS avg_duration_ms,
           COUNT(*) FILTER (WHERE (metadata->>'statusCode')::int >= 400) AS error_responses
         FROM user_activity
         WHERE activity_type = 'page_view'
           AND path IS NOT NULL
           AND created_at >= NOW() - ${intervalSql}
         GROUP BY path
         ORDER BY visits DESC
         LIMIT 30`
      ),
      // Errors encountered
      pool.query(
        `SELECT
           path,
           (metadata->>'statusCode')::int AS status_code,
           COUNT(*) AS occurrences
         FROM user_activity
         WHERE activity_type = 'page_view'
           AND (metadata->>'statusCode')::int >= 400
           AND created_at >= NOW() - ${intervalSql}
         GROUP BY path, status_code
         ORDER BY occurrences DESC
         LIMIT 20`
      ),
      // Top search queries
      pool.query(
        `SELECT
           metadata->>'query' AS query,
           COUNT(*) AS searches
         FROM user_activity
         WHERE activity_type = 'search'
           AND metadata->>'query' IS NOT NULL
           AND created_at >= NOW() - ${intervalSql}
         GROUP BY query
         ORDER BY searches DESC
         LIMIT 20`
      ),
    ]);

    res.json({
      success: true,
      data: {
        period: { days, generatedAt: new Date().toISOString() },
        topPaths: topPaths.rows.map((r) => ({
          path: r.path,
          visits: parseInt(r.visits),
          uniqueVisitors: parseInt(r.unique_visitors),
          averageDurationMs: r.avg_duration_ms ? parseInt(r.avg_duration_ms) : null,
          errorResponses: parseInt(r.error_responses) || 0,
        })),
        errors: errors.rows.map((r) => ({
          path: r.path,
          statusCode: r.status_code,
          occurrences: parseInt(r.occurrences),
        })),
        topSearchQueries: searchQueries.rows.map((r) => ({
          query: r.query,
          searches: parseInt(r.searches),
        })),
      },
    });
  } catch (error) {
    logger.error('Funnel analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to compute funnel analytics' });
  }
};

/**
 * GET /timeseries — Daily metrics over the requested range
 * Reads pre-computed daily_metrics for fast loading.
 */
const getTimeseries = async (req, res) => {
  try {
    const days = parseDaysRange(req);
    const scope = (req.query.scope || 'global').substring(0, 100);

    const result = await pool.query(
      `SELECT *
       FROM daily_metrics
       WHERE scope = $1
         AND date >= (CURRENT_DATE - INTERVAL '${days} days')::date
       ORDER BY date`,
      [scope]
    );

    res.json({
      success: true,
      data: {
        period: { days, scope, generatedAt: new Date().toISOString() },
        rows: result.rows.map((r) => ({
          date: r.date,
          examsCreated: r.exams_created,
          examsStarted: r.exams_started,
          examsCompleted: r.exams_completed,
          examsAbandoned: r.exams_abandoned,
          examsPassed: r.exams_passed,
          averageScore: r.average_score,
          averageTimeSpent: r.average_time_spent,
          questionsViewed: r.questions_viewed,
          questionsAnswered: r.questions_answered,
          questionsCorrect: r.questions_correct,
          questionsReported: r.questions_reported,
          uniqueUsers: r.unique_users,
          uniqueSessions: r.unique_sessions,
          newUsers: r.new_users,
          logins: r.logins,
          pageViews: r.page_views,
        })),
      },
    });
  } catch (error) {
    logger.error('Timeseries analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to load timeseries' });
  }
};

/**
 * POST /compute-daily — Manually trigger daily aggregation
 * Useful for backfills or testing.
 */
const triggerDailyComputation = async (req, res) => {
  try {
    const { date, scope } = req.body || {};
    const result = await telemetryService.computeDailyMetrics(date, scope || 'global');
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Trigger daily computation error:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger computation' });
  }
};

module.exports = {
  getOverview,
  getExamAnalytics,
  getQuestionAnalytics,
  getUserAnalytics,
  getFunnel,
  getTimeseries,
  triggerDailyComputation,
  // Exposed for testing
  parseDaysRange,
};
