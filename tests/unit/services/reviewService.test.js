/**
 * @fileoverview reviewService unit tests
 *
 * Covers:
 *   - The pure algorithm (nextSchedule) for the 4 quality grades and edge cases
 *   - parseQuality input coercion
 *   - clampEase bounds
 *   - High-level wrappers (recordAnswer, gradeReview) with mocked DB
 */

jest.mock('../../../src/database/pool', () => ({
  query: jest.fn(),
}));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const pool = require('../../../src/database/pool');
const reviewService = require('../../../src/services/reviewService');

const {
  nextSchedule,
  parseQuality,
  clampEase,
  recordAnswer,
  gradeReview,
  getDueItems,
  countDue,
  getStats,
  QUALITIES,
  EASE_DEFAULT,
  EASE_MIN,
  EASE_MAX,
} = reviewService;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('clampEase', () => {
  it('returns default for NaN', () => {
    expect(clampEase(Number.NaN)).toBe(EASE_DEFAULT);
  });
  it('caps high values at EASE_MAX', () => {
    expect(clampEase(99)).toBe(EASE_MAX);
  });
  it('floors low values at EASE_MIN', () => {
    expect(clampEase(0.1)).toBe(EASE_MIN);
  });
  it('passes valid values through', () => {
    expect(clampEase(2.0)).toBe(2.0);
  });
});

describe('parseQuality', () => {
  it('accepts integer 0..3', () => {
    expect(parseQuality(0)).toBe(0);
    expect(parseQuality(3)).toBe(3);
  });
  it('accepts string tokens', () => {
    expect(parseQuality('again')).toBe(0);
    expect(parseQuality('hard')).toBe(1);
    expect(parseQuality('good')).toBe(2);
    expect(parseQuality('easy')).toBe(3);
  });
  it('rejects out-of-range numbers', () => {
    expect(parseQuality(-1)).toBeNull();
    expect(parseQuality(4)).toBeNull();
  });
  it('rejects unknown strings', () => {
    expect(parseQuality('whatever')).toBeNull();
  });
  it('rejects non-integers', () => {
    expect(parseQuality(1.5)).toBeNull();
    expect(parseQuality(null)).toBeNull();
    expect(parseQuality(undefined)).toBeNull();
  });
});

describe('nextSchedule', () => {
  const fresh = () => ({ easeFactor: EASE_DEFAULT, intervalDays: 0, repetitions: 0, lapses: 0 });

  describe('quality 0 (again)', () => {
    it('resets repetitions and schedules 1 day out', () => {
      const r = nextSchedule({ easeFactor: 2.5, intervalDays: 30, repetitions: 5, lapses: 0 }, 0);
      expect(r.repetitions).toBe(0);
      expect(r.intervalDays).toBe(1);
      expect(r.lapses).toBe(1);
    });
    it('decreases ease factor', () => {
      const r = nextSchedule({ easeFactor: 2.5, intervalDays: 30, repetitions: 5, lapses: 0 }, 0);
      expect(r.easeFactor).toBeLessThan(2.5);
      expect(r.easeFactor).toBeGreaterThanOrEqual(EASE_MIN);
    });
  });

  describe('quality 1 (hard)', () => {
    it('reduces ease but keeps repetitions advancing', () => {
      const r = nextSchedule({ easeFactor: 2.5, intervalDays: 10, repetitions: 3, lapses: 0 }, 1);
      expect(r.easeFactor).toBeLessThan(2.5);
      expect(r.repetitions).toBe(4);
    });
    it('uses 1.2 multiplier for established cards', () => {
      const r = nextSchedule({ easeFactor: 2.5, intervalDays: 10, repetitions: 3, lapses: 0 }, 1);
      // 10 * 1.2 = 12
      expect(r.intervalDays).toBe(12);
    });
  });

  describe('quality 2 (good)', () => {
    it('keeps ease unchanged', () => {
      const r = nextSchedule({ easeFactor: 2.5, intervalDays: 10, repetitions: 3, lapses: 0 }, 2);
      expect(r.easeFactor).toBe(2.5);
    });
    it('first review schedules 1 day', () => {
      const r = nextSchedule(fresh(), 2);
      expect(r.repetitions).toBe(1);
      expect(r.intervalDays).toBe(1);
    });
    it('second review schedules 3 days', () => {
      const r = nextSchedule({ easeFactor: 2.5, intervalDays: 1, repetitions: 1, lapses: 0 }, 2);
      expect(r.repetitions).toBe(2);
      expect(r.intervalDays).toBe(3);
    });
    it('subsequent reviews multiply by ease', () => {
      const r = nextSchedule({ easeFactor: 2.5, intervalDays: 6, repetitions: 2, lapses: 0 }, 2);
      // 6 * 2.5 = 15
      expect(r.intervalDays).toBe(15);
    });
  });

  describe('quality 3 (easy)', () => {
    it('bumps ease factor', () => {
      const r = nextSchedule({ easeFactor: 2.5, intervalDays: 10, repetitions: 3, lapses: 0 }, 3);
      expect(r.easeFactor).toBeGreaterThan(2.5);
    });
    it('second review schedules 6 days (vs 3 for good)', () => {
      const r = nextSchedule({ easeFactor: 2.5, intervalDays: 1, repetitions: 1, lapses: 0 }, 3);
      expect(r.intervalDays).toBe(6);
    });
  });

  describe('edge cases', () => {
    it('caps interval at 365 days', () => {
      const r = nextSchedule({ easeFactor: 3.0, intervalDays: 200, repetitions: 10, lapses: 0 }, 3);
      expect(r.intervalDays).toBeLessThanOrEqual(365);
    });
    it('clamps ease never to exceed EASE_MAX', () => {
      let state = { easeFactor: 3.0, intervalDays: 30, repetitions: 5, lapses: 0 };
      for (let i = 0; i < 10; i++) {
        state = nextSchedule(state, 3);
      }
      expect(state.easeFactor).toBeLessThanOrEqual(EASE_MAX);
    });
    it('clamps ease never below EASE_MIN', () => {
      let state = { easeFactor: 1.5, intervalDays: 10, repetitions: 3, lapses: 0 };
      for (let i = 0; i < 10; i++) {
        state = nextSchedule(state, 0);
      }
      expect(state.easeFactor).toBeGreaterThanOrEqual(EASE_MIN);
    });
    it('produces a dueAt in the future', () => {
      const r = nextSchedule(fresh(), 2);
      expect(r.dueAt.getTime()).toBeGreaterThan(Date.now() - 1000);
    });
    it('handles missing state gracefully', () => {
      const r = nextSchedule(null, 2);
      expect(r.intervalDays).toBe(1);
      expect(r.repetitions).toBe(1);
    });
  });
});

describe('recordAnswer', () => {
  it('returns null for missing userId', async () => {
    const r = await recordAnswer(null, 'q1', true);
    expect(r).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns null for missing questionId', async () => {
    const r = await recordAnswer(1, null, true);
    expect(r).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('grades a correct answer as "good"', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })  // select
      .mockResolvedValueOnce({ rows: [{    // upsert
        question_id: 'q1',
        ease_factor: 2.5,
        interval_days: 1,
        repetitions: 1,
        lapses: 0,
        due_at: new Date(),
        last_reviewed_at: new Date(),
        last_quality: QUALITIES.good,
      }]});
    const r = await recordAnswer(1, 'q1', true);
    expect(r.lastQuality).toBe(QUALITIES.good);
    // Check upsert was called with quality=2 (good)
    const upsertParams = pool.query.mock.calls[1][1];
    expect(upsertParams[7]).toBe(QUALITIES.good);
  });

  it('grades an incorrect answer as "again"', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        question_id: 'q1',
        ease_factor: 2.2,
        interval_days: 1,
        repetitions: 0,
        lapses: 1,
        due_at: new Date(),
        last_reviewed_at: new Date(),
        last_quality: QUALITIES.again,
      }]});
    const r = await recordAnswer(1, 'q1', false);
    expect(r.lastQuality).toBe(QUALITIES.again);
    const upsertParams = pool.query.mock.calls[1][1];
    expect(upsertParams[7]).toBe(QUALITIES.again);
  });
});

describe('gradeReview', () => {
  it('throws 400 for invalid quality', async () => {
    await expect(gradeReview(1, 'q1', 99))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 for missing userId/questionId', async () => {
    await expect(gradeReview(null, 'q1', 2))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(gradeReview(1, null, 2))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts string quality tokens', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ question_id: 'q1', ease_factor: 2.65, interval_days: 6, repetitions: 1, lapses: 0, due_at: new Date(), last_reviewed_at: new Date(), last_quality: 3 }] });
    const r = await gradeReview(1, 'q1', 'easy');
    expect(r.lastQuality).toBe(3);
  });

  it('uses existing state when present', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{
        ease_factor: 2.8, interval_days: 14, repetitions: 4, lapses: 1,
      }]})
      .mockResolvedValueOnce({ rows: [{
        question_id: 'q1',
        ease_factor: 2.8,
        interval_days: 39, // 14 * 2.8 ≈ 39
        repetitions: 5,
        lapses: 1,
        due_at: new Date(),
        last_reviewed_at: new Date(),
        last_quality: 2,
      }]});
    const r = await gradeReview(1, 'q1', 'good');
    expect(r.intervalDays).toBeGreaterThan(14);
    expect(r.repetitions).toBe(5);
  });
});

describe('getDueItems', () => {
  it('returns empty for missing userId', async () => {
    const r = await getDueItems(null);
    expect(r).toEqual({ items: [], total: 0 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns due items with question text', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [
        {
          question_id: 'q1',
          ease_factor: 2.5, interval_days: 1, repetitions: 1, lapses: 0,
          due_at: new Date(), last_reviewed_at: new Date(), last_quality: 2,
          question_text: 'What is S3?', difficulty: 'easy', topic_name: 'Storage',
        },
      ]})
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    const r = await getDueItems(1, { limit: 10 });
    expect(r.total).toBe(1);
    expect(r.items[0].questionText).toBe('What is S3?');
    expect(r.items[0].topicName).toBe('Storage');
  });

  it('filters by certificationId when provided', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });
    await getDueItems(1, { certificationId: 42 });
    const firstParams = pool.query.mock.calls[0][1];
    expect(firstParams).toContain(42);
  });

  it('clamps limit to [1, 100]', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });
    await getDueItems(1, { limit: 9999 });
    const params = pool.query.mock.calls[0][1];
    expect(params).toContain(100);

    pool.query.mockClear();
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });
    await getDueItems(1, { limit: 0 });
    const params2 = pool.query.mock.calls[0][1];
    expect(params2).toContain(20); // default
  });
});

describe('countDue', () => {
  it('returns 0 for missing userId', async () => {
    expect(await countDue(null)).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('returns the row count', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ n: 7 }] });
    expect(await countDue(1)).toBe(7);
  });
  it('honors certificationId filter', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ n: 3 }] });
    await countDue(1, 42);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/certification_id/);
  });
});

describe('getStats', () => {
  it('returns null for missing userId', async () => {
    expect(await getStats(null)).toBeNull();
  });
  it('shapes the response with rounded ease', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      total_cards: 50,
      due_now: 7,
      reviewed_24h: 12,
      avg_ease: 2.456789,
      total_lapses: 9,
    }]});
    const r = await getStats(1);
    expect(r).toEqual({
      totalCards: 50,
      dueNow: 7,
      reviewed24h: 12,
      averageEase: 2.46,
      totalLapses: 9,
    });
  });
});
