/**
 * @fileoverview studyPlanService unit tests
 */

jest.mock('../../../src/database/pool', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const pool = require('../../../src/database/pool');
const svc = require('../../../src/services/studyPlanService');
const { suggestDailyGoal, daysBetween, todayUtcDate } = svc._internals;

beforeEach(() => jest.clearAllMocks());

describe('suggestDailyGoal', () => {
  it('returns 30 for cram (< 7 days)', () => {
    expect(suggestDailyGoal(3)).toBe(30);
    expect(suggestDailyGoal(6)).toBe(30);
  });
  it('returns 20 for 7-30 days', () => {
    expect(suggestDailyGoal(7)).toBe(20);
    expect(suggestDailyGoal(29)).toBe(20);
  });
  it('returns 15 for 30-90 days', () => {
    expect(suggestDailyGoal(30)).toBe(15);
    expect(suggestDailyGoal(89)).toBe(15);
  });
  it('returns 10 for 90+ days', () => {
    expect(suggestDailyGoal(90)).toBe(10);
    expect(suggestDailyGoal(365)).toBe(10);
  });
});

describe('daysBetween', () => {
  it('returns 1 for consecutive days', () => {
    expect(daysBetween('2026-05-15', '2026-05-16')).toBe(1);
  });
  it('returns negative for past targets', () => {
    expect(daysBetween('2026-05-15', '2026-05-10')).toBe(-5);
  });
  it('returns 0 for same day', () => {
    expect(daysBetween('2026-05-15', '2026-05-15')).toBe(0);
  });
});

describe('todayUtcDate', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(todayUtcDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('createPlan', () => {
  it('throws 401 for missing userId', async () => {
    await expect(svc.createPlan(null, { certificationId: 1, targetDate: '2099-01-01' }))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws 400 for invalid certificationId', async () => {
    await expect(svc.createPlan(1, { certificationId: 0, targetDate: '2099-01-01' }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.createPlan(1, { certificationId: 'abc', targetDate: '2099-01-01' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 for invalid targetDate format', async () => {
    await expect(svc.createPlan(1, { certificationId: 1, targetDate: 'next week' }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.createPlan(1, { certificationId: 1, targetDate: '2099/01/01' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 when targetDate is in the past or today', async () => {
    const today = todayUtcDate();
    await expect(svc.createPlan(1, { certificationId: 1, targetDate: today }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.createPlan(1, { certificationId: 1, targetDate: '2020-01-01' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 when targetDate is beyond horizon', async () => {
    await expect(svc.createPlan(1, { certificationId: 1, targetDate: '2099-12-31' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('deactivates previous plans and inserts a new one', async () => {
    // future date within horizon
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    pool.query
      .mockResolvedValueOnce({ rowCount: 1 })                                // UPDATE deactivate
      .mockResolvedValueOnce({ rows: [{                                     // INSERT
        id: 1, user_id: 1, certification_id: 5,
        target_date: future, daily_goal: 15, questions_answered: 0,
        is_active: true, created_at: new Date(),
      }]});
    const plan = await svc.createPlan(1, { certificationId: 5, targetDate: future });
    expect(pool.query).toHaveBeenCalledTimes(2);
    // First call must be the deactivate UPDATE
    expect(pool.query.mock.calls[0][0]).toMatch(/UPDATE study_plans/);
    expect(pool.query.mock.calls[0][1]).toEqual([1, 5]);
    expect(plan.dailyGoal).toBe(15);
    expect(plan.certificationId).toBe(5);
  });

  it('respects user-provided dailyGoal when valid', async () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    pool.query
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{
        id: 1, user_id: 1, certification_id: 5,
        target_date: future, daily_goal: 25, questions_answered: 0,
        is_active: true, created_at: new Date(),
      }]});
    const plan = await svc.createPlan(1, { certificationId: 5, targetDate: future, dailyGoal: 25 });
    expect(plan.dailyGoal).toBe(25);
    expect(pool.query.mock.calls[1][1][3]).toBe(25);
  });

  it('clamps dailyGoal to [5, 100]', async () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    pool.query
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{
        id: 1, user_id: 1, certification_id: 5,
        target_date: future, daily_goal: 100, questions_answered: 0,
        is_active: true, created_at: new Date(),
      }]});
    await svc.createPlan(1, { certificationId: 5, targetDate: future, dailyGoal: 999 });
    expect(pool.query.mock.calls[1][1][3]).toBe(100);
  });
});

describe('listActivePlans', () => {
  it('returns empty array for anon', async () => {
    expect(await svc.listActivePlans(null)).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('returns empty when no plans', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect(await svc.listActivePlans(1)).toEqual([]);
  });
  it('returns plans with progress fields', async () => {
    const future = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const created = new Date(Date.now() - 2 * 86400000); // 2 days ago
    pool.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        id: 1, user_id: 1, certification_id: 5,
        certification_name: 'AWS SAA', certification_code: 'SAA-C03',
        target_date: future, daily_goal: 20, questions_answered: 0,
        is_active: true, created_at: created,
      }]})
      .mockResolvedValueOnce({ rows: [{ n: 35 }] });
    const plans = await svc.listActivePlans(1);
    expect(plans).toHaveLength(1);
    expect(plans[0].dailyGoal).toBe(20);
    expect(plans[0].questionsAnswered).toBe(35);
    expect(plans[0].certificationName).toBe('AWS SAA');
    expect(plans[0].daysRemaining).toBeGreaterThanOrEqual(13);
    expect(plans[0].onTrack).toBe(false); // 35 answered, expected 60+ → not on track
  });
});

describe('cancelPlan', () => {
  it('throws 401 for anon', async () => {
    await expect(svc.cancelPlan(null, 1)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('throws 400 for invalid planId', async () => {
    await expect(svc.cancelPlan(1, 'abc')).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.cancelPlan(1, 0)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('returns cancelled=true when plan found and deactivated', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7 }] });
    expect(await svc.cancelPlan(1, 7)).toEqual({ cancelled: true });
  });
  it('returns cancelled=false when nothing matched', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect(await svc.cancelPlan(1, 7)).toEqual({ cancelled: false });
  });
});

describe('getActivePlanForCertification', () => {
  it('returns null for anon', async () => {
    expect(await svc.getActivePlanForCertification(null, 1)).toBeNull();
  });
  it('returns null when certificationId is invalid', async () => {
    expect(await svc.getActivePlanForCertification(1, 'abc')).toBeNull();
  });
  it('returns null when no active plan', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect(await svc.getActivePlanForCertification(1, 5)).toBeNull();
  });
  it('returns the plan with progress', async () => {
    const future = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    pool.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        id: 1, user_id: 1, certification_id: 5,
        certification_name: 'AWS', certification_code: 'X',
        target_date: future, daily_goal: 20, questions_answered: 0,
        is_active: true, created_at: new Date(),
      }]})
      .mockResolvedValueOnce({ rows: [{ n: 22 }] });
    const plan = await svc.getActivePlanForCertification(1, 5);
    expect(plan).not.toBeNull();
    expect(plan.questionsAnswered).toBe(22);
  });
});
