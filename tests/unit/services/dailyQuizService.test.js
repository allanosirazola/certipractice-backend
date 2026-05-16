/**
 * @fileoverview Daily Quiz Service unit tests
 */

jest.mock('../../../src/database/pool', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const pool = require('../../../src/database/pool');
const dailyQuiz = require('../../../src/services/dailyQuizService');
const { seededRng, strHash, pickSeeded, todayUtc } = dailyQuiz._internals;

beforeEach(() => jest.clearAllMocks());

describe('todayUtc', () => {
  it('returns YYYY-MM-DD format', () => {
    const d = todayUtc();
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('seededRng', () => {
  it('produces deterministic sequence for same seed', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });
  it('different seeds give different sequences', () => {
    const a = seededRng(1);
    const b = seededRng(2);
    expect(a()).not.toBe(b());
  });
});

describe('strHash', () => {
  it('returns deterministic 32-bit unsigned int', () => {
    const h = strHash('hello');
    expect(typeof h).toBe('number');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBe(strHash('hello'));
  });
  it('different inputs → different hashes (usually)', () => {
    expect(strHash('a')).not.toBe(strHash('b'));
  });
});

describe('pickSeeded', () => {
  it('returns all items when list shorter than n', () => {
    expect(pickSeeded([1, 2], 5, 0).sort()).toEqual([1, 2]);
  });
  it('picks exactly n items from a longer list', () => {
    expect(pickSeeded([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, 7).length).toBe(3);
  });
  it('is deterministic for the same seed', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(pickSeeded(items, 4, 99)).toEqual(pickSeeded(items, 4, 99));
  });
  it('different seeds produce different picks (usually)', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = pickSeeded(items, 4, 1).join(',');
    const b = pickSeeded(items, 4, 99).join(',');
    expect(a).not.toBe(b);
  });
});

describe('getDailyQuiz', () => {
  function setupPoolForFreshPick() {
    // 1st: existing completion lookup → empty (auth user, not completed)
    // 2nd: review-due query → empty
    // 3rd: candidate questions query
    // 4th: hydrate questions
    pool.query
      .mockResolvedValueOnce({ rows: [] })                                    // existing
      .mockResolvedValueOnce({ rows: [] })                                    // reviews due
      .mockResolvedValueOnce({                                                // candidates
        rows: Array.from({ length: 20 }, (_, i) => ({ id: `q${i}` })),
      })
      .mockResolvedValueOnce({                                                // hydrate
        rows: Array.from({ length: 5 }, (_, i) => ({
          id: `q${i}`,
          text: `Question ${i}?`,
          difficulty: 'easy',
          explanation: 'because.',
          topic_name: 'TopicX',
          options: [{ id: `o${i}a`, text: 'A', isCorrect: true }],
        })),
      });
  }

  it('returns the questions for an anonymous user', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: Array.from({ length: 20 }, (_, i) => ({ id: `q${i}` })),
      })
      .mockResolvedValueOnce({
        rows: Array.from({ length: 5 }, (_, i) => ({
          id: `q${i}`, text: `Q${i}`, difficulty: 'easy', topic_name: 'T',
          options: [{ id: 'o', text: 'A', isCorrect: true }],
        })),
      });
    const data = await dailyQuiz.getDailyQuiz(null);
    expect(data.completed).toBe(false);
    expect(data.previousScore).toBeNull();
    expect(data.questions.length).toBeGreaterThan(0);
    expect(data.questions[0]).toHaveProperty('id');
    expect(data.questions[0]).toHaveProperty('options');
  });

  it('reports completed when user has already submitted today', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ score: 4, question_ids: ['q1', 'q2', 'q3', 'q4', 'q5'] }],
      })
      .mockResolvedValueOnce({
        rows: ['q1', 'q2', 'q3', 'q4', 'q5'].map((id) => ({
          id, text: 'Q', difficulty: 'easy', topic_name: 'T',
          options: [{ id: 'o', text: 'A', isCorrect: true }],
        })),
      });
    const data = await dailyQuiz.getDailyQuiz(7);
    expect(data.completed).toBe(true);
    expect(data.previousScore).toBe(4);
    expect(data.questions.length).toBe(5);
  });

  it('mixes review cards with fresh picks for an authed user', async () => {
    // pickSeeded chooses 3 of the 12 candidates non-deterministically from
    // the test's POV (the seed depends on todayUtc()). To stay robust,
    // mock the hydrate to return rows for ALL possible IDs — whichever
    // 3 are picked will then find their row.
    const allIds = ['r1', 'r2', ...Array.from({ length: 12 }, (_, i) => `f${i}`)];
    pool.query
      .mockResolvedValueOnce({ rows: [] })                                  // no completion
      .mockResolvedValueOnce({ rows: [                                      // 2 reviews due
        { question_id: 'r1' }, { question_id: 'r2' },
      ]})
      .mockResolvedValueOnce({ rows: Array.from({ length: 12 }, (_, i) => ({ id: `f${i}` })) })
      .mockResolvedValueOnce({
        rows: allIds.map((id) => ({
          id, text: 'Q', difficulty: 'easy', topic_name: 'T',
          options: [{ id: 'o', text: 'A', isCorrect: true }],
        })),
      });
    const data = await dailyQuiz.getDailyQuiz(7);
    expect(data.questions.length).toBe(5);
    // r1 and r2 are guaranteed (they came from the reviews-due query)
    expect(data.questions.find((q) => q.id === 'r1')).toBeDefined();
    expect(data.questions.find((q) => q.id === 'r2')).toBeDefined();
    // The remaining 3 are fresh picks — all from the f0..f11 pool
    const fresh = data.questions.filter((q) => q.id.startsWith('f'));
    expect(fresh.length).toBe(3);
  });
});

describe('submitDailyQuiz', () => {
  it('throws 401 for missing userId', async () => {
    await expect(dailyQuiz.submitDailyQuiz(null, [{ questionId: 'q', isCorrect: true }]))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws 400 for missing answers', async () => {
    await expect(dailyQuiz.submitDailyQuiz(1, null))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(dailyQuiz.submitDailyQuiz(1, []))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('counts correct answers and inserts a completion row', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 99 }] });
    const r = await dailyQuiz.submitDailyQuiz(1, [
      { questionId: 'q1', isCorrect: true },
      { questionId: 'q2', isCorrect: false },
      { questionId: 'q3', isCorrect: true },
      { questionId: 'q4', isCorrect: true },
      { questionId: 'q5', isCorrect: false },
    ]);
    expect(r).toEqual({ score: 3, total: 5, alreadyCompleted: false });
    const params = pool.query.mock.calls[0][1];
    expect(params[0]).toBe(1);   // userId
    expect(params[2]).toBe(3);   // score
    expect(params[3]).toBe(5);   // total
  });

  it('marks alreadyCompleted when ON CONFLICT skips insert', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const r = await dailyQuiz.submitDailyQuiz(1, [
      { questionId: 'q1', isCorrect: true },
    ]);
    expect(r.alreadyCompleted).toBe(true);
  });
});

describe('hasCompletedToday', () => {
  it('returns false for anon', async () => {
    expect(await dailyQuiz.hasCompletedToday(null)).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('returns true when row exists', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    expect(await dailyQuiz.hasCompletedToday(1)).toBe(true);
  });
  it('returns false when no row', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect(await dailyQuiz.hasCompletedToday(1)).toBe(false);
  });
});
