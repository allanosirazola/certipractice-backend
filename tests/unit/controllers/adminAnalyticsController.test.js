/**
 * @fileoverview Admin Analytics Controller Tests
 *
 * Each endpoint runs several aggregation SELECTs in parallel and
 * shapes the response. We mock the pool to return canned rows
 * and verify the response structure + math (rates, deltas).
 */

jest.mock('../../../src/database/pool', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/services/telemetryService', () => ({
  computeDailyMetrics: jest.fn(),
}));

const pool = require('../../../src/database/pool');
const telemetry = require('../../../src/services/telemetryService');
const controller = require('../../../src/controllers/adminAnalyticsController');

describe('AdminAnalyticsController', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { user: { id: 1, role: 'admin' }, query: {}, body: {} };
    res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  });

  describe('parseDaysRange', () => {
    it('defaults to 7 when query is missing or invalid', () => {
      expect(controller.parseDaysRange({ query: {} })).toBe(7);
      expect(controller.parseDaysRange({ query: { days: 'abc' } })).toBe(7);
      expect(controller.parseDaysRange({ query: { days: '0' } })).toBe(7);
      expect(controller.parseDaysRange({ query: { days: '-5' } })).toBe(7);
    });

    it('honors valid integer values up to 365', () => {
      expect(controller.parseDaysRange({ query: { days: '30' } })).toBe(30);
      expect(controller.parseDaysRange({ query: { days: '365' } })).toBe(365);
    });

    it('caps the range at 365', () => {
      expect(controller.parseDaysRange({ query: { days: '1000' } })).toBe(365);
    });
  });

  describe('getOverview', () => {
    it('returns the full KPI shape with computed rates', async () => {
      pool.query
        // exams
        .mockResolvedValueOnce({ rows: [{
          created: '12', started: '10', completed: '8', abandoned: '2',
          passed: '6', avg_score: '78.5', avg_time_seconds: '900',
        }]})
        // questions
        .mockResolvedValueOnce({ rows: [{
          views: '500', answered: '300', correct: '210', unique_questions: '85',
        }]})
        // users
        .mockResolvedValueOnce({ rows: [{
          active_users: '45', active_sessions: '20',
          logins: '60', registrations: '5', page_views: '1200',
        }]})
        // comparison (previous period)
        .mockResolvedValueOnce({ rows: [{ prev_completed: '4', prev_users: '30' }] });

      await controller.getOverview(req, res);

      expect(res.json).toHaveBeenCalledTimes(1);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.exams).toMatchObject({
        created: 12, started: 10, completed: 8, abandoned: 2, passed: 6,
        completionRate: 80,            // 8/10
        passRate: 75,                  // 6/8
        averageScore: 78.5,
        averageTimeMinutes: 15,        // 900s = 15min
        completedDeltaPercent: 100,    // (8-4)/4 = 100%
      });
      expect(body.data.questions).toMatchObject({
        views: 500, answered: 300, correct: 210, accuracyRate: 70,
        uniqueQuestionsTouched: 85,
      });
      expect(body.data.users).toMatchObject({
        activeUsers: 45, activeSessions: 20, logins: 60,
        registrations: 5, pageViews: 1200,
      });
    });

    it('handles zero divisions safely', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{
          created: '0', started: '0', completed: '0', abandoned: '0', passed: '0',
          avg_score: null, avg_time_seconds: null,
        }]})
        .mockResolvedValueOnce({ rows: [{
          views: '0', answered: '0', correct: '0', unique_questions: '0',
        }]})
        .mockResolvedValueOnce({ rows: [{
          active_users: '0', active_sessions: '0',
          logins: '0', registrations: '0', page_views: '0',
        }]})
        .mockResolvedValueOnce({ rows: [{ prev_completed: '0', prev_users: '0' }] });

      await controller.getOverview(req, res);
      const body = res.json.mock.calls[0][0];
      expect(body.data.exams.completionRate).toBe(0);
      expect(body.data.exams.passRate).toBe(0);
      expect(body.data.questions.accuracyRate).toBe(0);
      expect(body.data.exams.completedDeltaPercent).toBeNull();
    });

    it('returns 500 on query failure', async () => {
      pool.query.mockRejectedValue(new Error('boom'));
      await controller.getOverview(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getExamAnalytics', () => {
    it('returns funnel + status + mode + abandon + slow lists', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [
          { day: '2026-04-01', created: '5', started: '4', completed: '3', abandoned: '1' },
        ]})
        .mockResolvedValueOnce({ rows: [
          { status: 'completed', count: '8' },
          { status: 'abandoned', count: '2' },
        ]})
        .mockResolvedValueOnce({ rows: [
          { mode: 'practice', count: '6', avg_score: '80' },
        ]})
        .mockResolvedValueOnce({ rows: [
          { question_index: 5, abandonments: '3' },
        ]})
        .mockResolvedValueOnce({ rows: [
          { exam_id: 'e1', avg_time_seconds: '1800', completions: '2' },
        ]});

      await controller.getExamAnalytics(req, res);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.dailyFunnel).toHaveLength(1);
      expect(body.data.dailyFunnel[0].started).toBe(4);
      expect(body.data.statusDistribution).toHaveLength(2);
      expect(body.data.byMode[0]).toMatchObject({ mode: 'practice', count: 6, averageScore: 80 });
      expect(body.data.abandonmentByQuestionIndex[0].abandonments).toBe(3);
      expect(body.data.slowestExams[0].averageTimeMinutes).toBe(30);
    });
  });

  describe('getQuestionAnalytics', () => {
    it('returns most failed/viewed/reported with truncated previews', async () => {
      const longText = 'A'.repeat(200);
      pool.query
        .mockResolvedValueOnce({ rows: [
          { question_id: 'q1', question_text: longText, difficulty_level: 'hard',
            topic_name: 'S3', certification_name: 'AWS',
            attempts: '20', failures: '15', fail_rate: '75.0' },
        ]})
        .mockResolvedValueOnce({ rows: [
          { question_id: 'q2', question_text: 'short', topic_name: 'EC2', views: '50' },
        ]})
        .mockResolvedValueOnce({ rows: [
          { question_id: 'q3', question_text: 'reported one', reports: '4' },
        ]})
        .mockResolvedValueOnce({ rows: [
          { bucket: '0-25%', questions: '3' },
          { bucket: '25-50%', questions: '7' },
        ]})
        .mockResolvedValueOnce({ rows: [
          { difficulty_level: 'easy', attempts: '100', accuracy_rate: '90.0', avg_time_seconds: '15' },
        ]});

      await controller.getQuestionAnalytics(req, res);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.mostFailedQuestions[0].failRate).toBe(75);
      // Long preview must be truncated with ellipsis
      expect(body.data.mostFailedQuestions[0].preview.length).toBeLessThanOrEqual(121);
      expect(body.data.mostFailedQuestions[0].preview).toMatch(/…$/);
      expect(body.data.mostViewedQuestions[0].views).toBe(50);
      expect(body.data.mostReportedQuestions[0].reports).toBe(4);
      expect(body.data.accuracyDistribution).toHaveLength(2);
      expect(body.data.byDifficulty[0]).toMatchObject({
        difficulty: 'easy', attempts: 100, accuracyRate: 90,
      });
    });

    it('caps limit at 100', async () => {
      req.query.limit = '500';
      pool.query.mockResolvedValue({ rows: [] });

      await controller.getQuestionAnalytics(req, res);

      // First query (mostFailed) takes the limit param at index 0
      const firstCallParams = pool.query.mock.calls[0][1];
      expect(firstCallParams[0]).toBe(100);
    });
  });

  describe('getUserAnalytics', () => {
    it('returns DAU + registrations + most-active list + duration percentiles', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [
          { day: '2026-04-01', dau: '20', anon_sessions: '10' },
        ]})
        .mockResolvedValueOnce({ rows: [{ day: '2026-04-01', registrations: '3' }] })
        .mockResolvedValueOnce({ rows: [
          { id: 1, username: 'alice', email: 'a@x', activities: '50', page_views: '40', exams_completed: '5' },
        ]})
        .mockResolvedValueOnce({ rows: [{
          avg_duration_ms: '1500', median_duration_ms: '1200', p95_duration_ms: '4500',
        }]})
        .mockResolvedValueOnce({ rows: [{ authenticated: '300', anonymous: '100' }] });

      await controller.getUserAnalytics(req, res);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.dailyActiveUsers[0].authenticatedUsers).toBe(20);
      expect(body.data.registrationsByDay[0].registrations).toBe(3);
      expect(body.data.mostActiveUsers[0].username).toBe('alice');
      expect(body.data.pageViewDuration).toMatchObject({
        averageMs: 1500, medianMs: 1200, p95Ms: 4500,
      });
      expect(body.data.userSplit).toMatchObject({ authenticated: 300, anonymous: 100 });
    });
  });

  describe('getFunnel', () => {
    it('returns top paths, errors and search queries', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [
          { path: '/exams', visits: '500', unique_visitors: '200',
            avg_duration_ms: '300', error_responses: '5' },
        ]})
        .mockResolvedValueOnce({ rows: [
          { path: '/api/foo', status_code: 404, occurrences: '12' },
        ]})
        .mockResolvedValueOnce({ rows: [
          { query: 'aws s3', searches: '40' },
        ]});

      await controller.getFunnel(req, res);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.topPaths[0]).toMatchObject({
        path: '/exams', visits: 500, uniqueVisitors: 200, errorResponses: 5,
      });
      expect(body.data.errors[0].statusCode).toBe(404);
      expect(body.data.topSearchQueries[0].query).toBe('aws s3');
    });
  });

  describe('getTimeseries', () => {
    it('reads from daily_metrics with default scope=global', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{
        date: '2026-04-01',
        exams_created: 5, exams_started: 4, exams_completed: 3, exams_abandoned: 1,
        exams_passed: 2, average_score: 75, average_time_spent: 900,
        questions_viewed: 50, questions_answered: 30, questions_correct: 20, questions_reported: 1,
        unique_users: 10, unique_sessions: 5, new_users: 1, logins: 8, page_views: 100,
      }]});

      await controller.getTimeseries(req, res);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.period.scope).toBe('global');
      expect(body.data.rows).toHaveLength(1);
      expect(body.data.rows[0]).toMatchObject({
        examsCreated: 5, examsCompleted: 3, averageScore: 75, pageViews: 100,
      });
    });

    it('honors a custom scope from the query', async () => {
      req.query.scope = 'cert:42';
      pool.query.mockResolvedValueOnce({ rows: [] });
      await controller.getTimeseries(req, res);
      const params = pool.query.mock.calls[0][1];
      expect(params[0]).toBe('cert:42');
    });
  });

  describe('triggerDailyComputation', () => {
    it('delegates to telemetryService and returns success', async () => {
      telemetry.computeDailyMetrics.mockResolvedValue({
        success: true, date: '2026-04-30', scope: 'global',
      });
      req.body = { date: '2026-04-30', scope: 'global' };

      await controller.triggerDailyComputation(req, res);

      expect(telemetry.computeDailyMetrics).toHaveBeenCalledWith('2026-04-30', 'global');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('returns 500 when computation fails', async () => {
      telemetry.computeDailyMetrics.mockResolvedValue({
        success: false, error: 'oops',
      });
      await controller.triggerDailyComputation(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
