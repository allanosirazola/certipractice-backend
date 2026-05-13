/**
 * @fileoverview Tests for ProgressService.
 *
 * Covers:
 *  - getStreak: empty, today-only, multi-day streak, broken streak, at-risk
 *  - getReadiness: invalid input, no cert, insufficient samples, ready/not
 *  - probability mapping (pure function via _internals)
 *  - trend classification
 *  - longest streak computation across various patterns
 */

jest.mock('../../../src/database/pool', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const pool = require('../../../src/database/pool');
const progressService = require('../../../src/services/progressService');
const { _internals, READINESS_MIN_SAMPLES } = progressService;

describe('ProgressService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── pure helpers ──────────────────────────────────────────────────────
  describe('toDateKey', () => {
    it('formats a Date as UTC YYYY-MM-DD', () => {
      expect(_internals.toDateKey(new Date('2026-04-15T15:30:00Z'))).toBe('2026-04-15');
    });
    it('returns first 10 chars of a string', () => {
      expect(_internals.toDateKey('2026-04-15T00:00:00Z')).toBe('2026-04-15');
    });
  });

  describe('computeLongestStreak', () => {
    it('returns 0 for empty', () => {
      expect(_internals.computeLongestStreak([])).toBe(0);
    });
    it('returns 1 for a single day', () => {
      expect(_internals.computeLongestStreak(['2026-04-15'])).toBe(1);
    });
    it('returns full length for fully consecutive days (DESC)', () => {
      expect(_internals.computeLongestStreak([
        '2026-04-17', '2026-04-16', '2026-04-15',
      ])).toBe(3);
    });
    it('finds the longest run when broken', () => {
      // 17, 16 (run=2), 14, 13, 12 (run=3), 10 (run=1) → 3
      expect(_internals.computeLongestStreak([
        '2026-04-17', '2026-04-16', '2026-04-14', '2026-04-13', '2026-04-12', '2026-04-10',
      ])).toBe(3);
    });
  });

  describe('estimateProbability', () => {
    it('returns 0 for completely failing accuracy', () => {
      expect(_internals.estimateProbability(0, 70)).toBe(0);
    });
    it('returns ~0.5 at passing score', () => {
      expect(_internals.estimateProbability(70, 70)).toBeCloseTo(0.5, 2);
    });
    it('returns 0.85 at passing+10', () => {
      expect(_internals.estimateProbability(80, 70)).toBeCloseTo(0.85, 2);
    });
    it('caps at 0.99', () => {
      expect(_internals.estimateProbability(100, 70)).toBeCloseTo(0.99, 2);
    });
    it('scales sub-passing linearly to 0..0.5', () => {
      // 35 of 70 → halfway → 0.25
      expect(_internals.estimateProbability(35, 70)).toBeCloseTo(0.25, 2);
    });
  });

  describe('classifyTrend', () => {
    it('returns "improving" for delta > 3pp', () => {
      expect(_internals.classifyTrend(5)).toBe('improving');
    });
    it('returns "declining" for delta < -3pp', () => {
      expect(_internals.classifyTrend(-10)).toBe('declining');
    });
    it('returns "stable" for small deltas', () => {
      expect(_internals.classifyTrend(2)).toBe('stable');
      expect(_internals.classifyTrend(-2)).toBe('stable');
      expect(_internals.classifyTrend(0)).toBe('stable');
    });
  });

  // ─── getStreak ─────────────────────────────────────────────────────────
  describe('getStreak', () => {
    it('returns zeros when no userId', async () => {
      const result = await progressService.getStreak(null);
      expect(result).toEqual({
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: null,
        streakAtRisk: false,
        activeToday: false,
      });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns zeros when no activity rows', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const result = await progressService.getStreak(1);
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(0);
    });

    it('counts a streak ending today', async () => {
      const today = new Date();
      const days = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - i);
        days.push({ day: d.toISOString().substring(0, 10) });
      }
      pool.query.mockResolvedValueOnce({ rows: days });
      const result = await progressService.getStreak(1);
      expect(result.currentStreak).toBe(5);
      expect(result.activeToday).toBe(true);
      expect(result.streakAtRisk).toBe(false);
    });

    it('flags streakAtRisk when last activity was yesterday only', async () => {
      const yesterday = new Date(Date.now() - 86400000);
      pool.query.mockResolvedValueOnce({
        rows: [{ day: yesterday.toISOString().substring(0, 10) }],
      });
      const result = await progressService.getStreak(1);
      expect(result.currentStreak).toBe(1);
      expect(result.activeToday).toBe(false);
      expect(result.streakAtRisk).toBe(true);
    });

    it('returns currentStreak=0 when last activity was older than yesterday', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
      pool.query.mockResolvedValueOnce({
        rows: [{ day: twoDaysAgo.toISOString().substring(0, 10) }],
      });
      const result = await progressService.getStreak(1);
      expect(result.currentStreak).toBe(0);
      expect(result.streakAtRisk).toBe(false);
    });

    it('handles DB errors gracefully', async () => {
      pool.query.mockRejectedValueOnce(new Error('boom'));
      const result = await progressService.getStreak(1);
      expect(result.currentStreak).toBe(0);
    });
  });

  // ─── getReadiness ──────────────────────────────────────────────────────
  describe('getReadiness', () => {
    it('returns invalid_input shell when args missing', async () => {
      const r = await progressService.getReadiness(null, null);
      expect(r.probability).toBeNull();
      expect(r.recommendation).toBe('invalid_input');
    });

    it('returns cert_not_found when certification does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const r = await progressService.getReadiness(1, 999);
      expect(r.recommendation).toBe('cert_not_found');
    });

    it('returns need_more_practice when sample size is below threshold', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'AWS SAA', passing_score: 70 }] })
        .mockResolvedValueOnce({
          rows: Array(READINESS_MIN_SAMPLES - 5).fill({
            is_correct: true,
            created_at: new Date(),
          }),
        });
      const r = await progressService.getReadiness(1, 1);
      expect(r.recommendation).toBe('need_more_practice');
      expect(r.passingScore).toBe(70);
      expect(r.samples).toBe(READINESS_MIN_SAMPLES - 5);
    });

    it('returns "ready" when accuracy is well above passing', async () => {
      // 50 attempts, 90% correct
      const attempts = Array.from({ length: 50 }, (_, i) => ({
        is_correct: i < 45, // 90%
        created_at: new Date(),
      }));
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'AWS SAA', passing_score: 70 }] })
        .mockResolvedValueOnce({ rows: attempts });
      const r = await progressService.getReadiness(1, 1);
      expect(r.ready).toBe(true);
      expect(r.accuracy).toBe(90);
      expect(r.probability).toBeGreaterThanOrEqual(0.85);
      expect(r.recommendation).toBe('ready');
    });

    it('returns "borderline" when accuracy is just above passing', async () => {
      const attempts = Array.from({ length: 50 }, (_, i) => ({
        is_correct: i < 36, // 72%
        created_at: new Date(),
      }));
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'AWS SAA', passing_score: 70 }] })
        .mockResolvedValueOnce({ rows: attempts });
      const r = await progressService.getReadiness(1, 1);
      expect(r.ready).toBe(false);
      expect(r.recommendation).toBe('borderline');
    });

    it('returns "keep_studying" when below passing', async () => {
      const attempts = Array.from({ length: 50 }, (_, i) => ({
        is_correct: i < 25, // 50%
        created_at: new Date(),
      }));
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'AWS SAA', passing_score: 70 }] })
        .mockResolvedValueOnce({ rows: attempts });
      const r = await progressService.getReadiness(1, 1);
      expect(r.ready).toBe(false);
      expect(r.recommendation).toBe('keep_studying');
    });

    it('classifies trend "improving" when recent half outperforms older half', async () => {
      // attempts is DESC: first half = recent (more correct), second half = older (less)
      const recent = Array.from({ length: 25 }, () => ({ is_correct: true, created_at: new Date() }));
      const older = Array.from({ length: 25 }, () => ({ is_correct: false, created_at: new Date() }));
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'AWS SAA', passing_score: 70 }] })
        .mockResolvedValueOnce({ rows: [...recent, ...older] });
      const r = await progressService.getReadiness(1, 1);
      expect(r.trend).toBe('improving');
    });

    it('handles DB errors during attempts query', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'AWS SAA', passing_score: 70 }] })
        .mockRejectedValueOnce(new Error('db down'));
      const r = await progressService.getReadiness(1, 1);
      expect(r.recommendation).toBe('no_data');
      expect(r.passingScore).toBe(70);
    });

    it('uses default passing_score 70 when cert has none set', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'AWS SAA', passing_score: null }] })
        .mockResolvedValueOnce({ rows: Array(50).fill({ is_correct: true, created_at: new Date() }) });
      const r = await progressService.getReadiness(1, 1);
      expect(r.passingScore).toBe(70);
    });
  });
});
