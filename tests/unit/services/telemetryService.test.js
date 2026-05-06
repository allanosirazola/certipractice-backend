/**
 * @fileoverview Telemetry Service Tests
 */

jest.mock('../../../src/database/pool', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const pool = require('../../../src/database/pool');
const telemetry = require('../../../src/services/telemetryService');

describe('TelemetryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  describe('extractIdentity', () => {
    it('returns nulls for null req', () => {
      const id = telemetry.extractIdentity(null);
      expect(id).toEqual({
        userId: null,
        sessionId: null,
        ipAddress: null,
        userAgent: null,
      });
    });

    it('extracts authenticated user identity', () => {
      const req = {
        user: { id: 42 },
        sessionId: 'sess-1',
        ip: '127.0.0.1',
        headers: { 'user-agent': 'jest' },
      };
      const id = telemetry.extractIdentity(req);
      expect(id.userId).toBe(42);
      expect(id.sessionId).toBe('sess-1');
      expect(id.ipAddress).toBe('127.0.0.1');
      expect(id.userAgent).toBe('jest');
    });

    it('extracts anonymous session identity', () => {
      const req = {
        sessionId: 'sess-anon',
        ip: '10.0.0.1',
        headers: {},
      };
      const id = telemetry.extractIdentity(req);
      expect(id.userId).toBeNull();
      expect(id.sessionId).toBe('sess-anon');
    });

    it('truncates very long user-agent to 500 chars', () => {
      const longUA = 'a'.repeat(1000);
      const id = telemetry.extractIdentity({
        ip: '1.2.3.4',
        headers: { 'user-agent': longUA },
      });
      expect(id.userAgent).toHaveLength(500);
    });

    it('falls back to x-forwarded-for when ip is missing', () => {
      const id = telemetry.extractIdentity({
        headers: { 'x-forwarded-for': '8.8.8.8' },
      });
      expect(id.ipAddress).toBe('8.8.8.8');
    });
  });

  describe('trackExamEvent', () => {
    it('inserts an exam event with metadata', async () => {
      await telemetry.trackExamEvent({
        examId: 'exam-uuid-1',
        eventType: 'exam_started',
        req: { user: { id: 5 }, sessionId: null, ip: '127.0.0.1', headers: {} },
        metadata: { mode: 'practice', questionCount: 20 },
      });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO exam_events');
      expect(params[0]).toBe('exam-uuid-1');
      expect(params[1]).toBe(5);
      expect(params[3]).toBe('exam_started');
      expect(JSON.parse(params[4])).toEqual({ mode: 'practice', questionCount: 20 });
    });

    it('handles anonymous sessions', async () => {
      await telemetry.trackExamEvent({
        examId: 'exam-uuid-2',
        eventType: 'exam_completed',
        req: { sessionId: 'sess-x', ip: '1.1.1.1', headers: {} },
        metadata: { score: 85, passed: true, timeSpent: 1200 },
      });

      const [, params] = pool.query.mock.calls[0];
      expect(params[1]).toBeNull();
      expect(params[2]).toBe('sess-x');
      expect(params[3]).toBe('exam_completed');
    });

    it('serializes null metadata correctly', async () => {
      await telemetry.trackExamEvent({
        examId: 'exam-uuid-3',
        eventType: 'exam_paused',
        req: { user: { id: 1 }, headers: {} },
      });

      const [, params] = pool.query.mock.calls[0];
      expect(params[4]).toBeNull();
    });

    it('never throws even when DB fails (fire-and-forget)', async () => {
      pool.query.mockRejectedValueOnce(new Error('Connection refused'));
      await expect(
        telemetry.trackExamEvent({
          examId: 'exam-uuid-4',
          eventType: 'exam_started',
          req: { user: { id: 1 }, headers: {} },
        })
      ).resolves.not.toThrow();
    });

    it('uses explicit userId/sessionId overrides', async () => {
      await telemetry.trackExamEvent({
        examId: 'exam-uuid-5',
        eventType: 'exam_created',
        userId: 99,
        sessionId: 'override-sess',
      });

      const [, params] = pool.query.mock.calls[0];
      expect(params[1]).toBe(99);
      expect(params[2]).toBe('override-sess');
    });

    it('records questionIndex for navigation events', async () => {
      await telemetry.trackExamEvent({
        examId: 'exam-uuid-6',
        eventType: 'exam_navigated',
        req: { user: { id: 1 }, headers: {} },
        questionIndex: 7,
      });

      const [, params] = pool.query.mock.calls[0];
      expect(params[5]).toBe(7);
    });
  });

  describe('trackQuestionEvent', () => {
    it('inserts a question answered event with isCorrect', async () => {
      await telemetry.trackQuestionEvent({
        questionId: 'q-uuid-1',
        eventType: 'answered',
        isCorrect: true,
        timeSpent: 45,
        req: { user: { id: 7 }, headers: {} },
        metadata: { examId: 'exam-1' },
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO question_events');
      expect(params[0]).toBe('q-uuid-1');
      expect(params[3]).toBe('answered');
      expect(params[4]).toBe(true);
      expect(params[5]).toBe(45);
    });

    it('handles viewed events without isCorrect', async () => {
      await telemetry.trackQuestionEvent({
        questionId: 'q-uuid-2',
        eventType: 'viewed',
        req: { sessionId: 'sess-1', headers: {} },
      });

      const [, params] = pool.query.mock.calls[0];
      expect(params[3]).toBe('viewed');
      expect(params[4]).toBeNull();
      expect(params[5]).toBeNull();
    });

    it('never throws on DB error', async () => {
      pool.query.mockRejectedValueOnce(new Error('Timeout'));
      await expect(
        telemetry.trackQuestionEvent({
          questionId: 'q-uuid-3',
          eventType: 'reported',
          req: { user: { id: 1 }, headers: {} },
        })
      ).resolves.not.toThrow();
    });
  });

  describe('trackUserActivity', () => {
    it('inserts a login activity', async () => {
      await telemetry.trackUserActivity({
        activityType: 'login',
        req: { user: { id: 3 }, ip: '127.0.0.1', headers: {} },
        metadata: { username: 'alice' },
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO user_activity');
      expect(params[2]).toBe('login');
    });

    it('truncates long path/referrer to 500 chars', async () => {
      const longPath = '/x'.repeat(500);
      await telemetry.trackUserActivity({
        activityType: 'page_view',
        path: longPath,
        referrer: longPath,
        req: { user: { id: 1 }, headers: {} },
      });

      const [, params] = pool.query.mock.calls[0];
      expect(params[3]).toHaveLength(500);
      expect(params[4]).toHaveLength(500);
    });

    it('records duration_ms', async () => {
      await telemetry.trackUserActivity({
        activityType: 'page_view',
        path: '/dashboard',
        durationMs: 1234,
        req: { user: { id: 1 }, headers: {} },
      });

      const [, params] = pool.query.mock.calls[0];
      expect(params[6]).toBe(1234);
    });

    it('never throws on DB error', async () => {
      pool.query.mockRejectedValueOnce(new Error('FK violation'));
      await expect(
        telemetry.trackUserActivity({
          activityType: 'logout',
          req: { user: { id: 1 }, headers: {} },
        })
      ).resolves.not.toThrow();
    });
  });

  describe('trackBatch', () => {
    it('returns 0 tracked for empty array', async () => {
      const result = await telemetry.trackBatch([]);
      expect(result).toEqual({ tracked: 0 });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns 0 tracked for non-array input', async () => {
      const result = await telemetry.trackBatch(null);
      expect(result).toEqual({ tracked: 0 });
    });

    it('processes mixed event types', async () => {
      const result = await telemetry.trackBatch([
        { type: 'exam', payload: { examId: 'e1', eventType: 'exam_started' } },
        { type: 'question', payload: { questionId: 'q1', eventType: 'viewed' } },
        { type: 'activity', payload: { activityType: 'page_view' } },
      ]);

      expect(result).toEqual({ tracked: 3, total: 3 });
      expect(pool.query).toHaveBeenCalledTimes(3);
    });

    it('skips unknown event types', async () => {
      const result = await telemetry.trackBatch([
        { type: 'exam', payload: { examId: 'e1', eventType: 'exam_started' } },
        { type: 'unknown', payload: {} },
      ]);

      expect(result).toEqual({ tracked: 1, total: 2 });
    });
  });

  describe('computeDailyMetrics', () => {
    beforeEach(() => {
      pool.query.mockResolvedValue({
        rows: [
          {
            exams_created: '0', exams_started: '0', exams_completed: '0',
            exams_abandoned: '0', exams_passed: '0', average_score: null,
            average_time_spent: null, questions_viewed: '0',
            questions_answered: '0', questions_correct: '0',
            questions_reported: '0', unique_users: '0',
            unique_sessions: '0', new_users: '0', logins: '0',
            page_views: '0',
          },
        ],
      });
    });

    it('computes for a specific date', async () => {
      const result = await telemetry.computeDailyMetrics('2026-04-01', 'global');
      expect(result.success).toBe(true);
      expect(result.date).toBe('2026-04-01');
      expect(result.scope).toBe('global');
      expect(pool.query).toHaveBeenCalledTimes(5);
    });

    it('defaults scope to "global"', async () => {
      const result = await telemetry.computeDailyMetrics('2026-04-02');
      expect(result.scope).toBe('global');
    });

    it('returns success=false on DB failure', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB down'));
      const result = await telemetry.computeDailyMetrics('2026-04-03');
      expect(result.success).toBe(false);
      expect(result.error).toBe('DB down');
    });

    it('uses yesterday by default when no date passed', async () => {
      const result = await telemetry.computeDailyMetrics();
      expect(result.success).toBe(true);
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
