/**
 * @fileoverview reviewController unit tests
 */

jest.mock('../../../src/services/reviewService', () => ({
  getDueItems: jest.fn(),
  getStats: jest.fn(),
  gradeReview: jest.fn(),
}));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const reviewService = require('../../../src/services/reviewService');
const { getDue, getStats, gradeReview } = require('../../../src/controllers/reviewController');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reviewController.getDue', () => {
  it('returns 401 for anonymous users', async () => {
    const req = { user: null, query: {} };
    const res = makeRes();
    await getDue(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(reviewService.getDueItems).not.toHaveBeenCalled();
  });

  it('returns the data envelope on success', async () => {
    reviewService.getDueItems.mockResolvedValue({
      items: [{ questionId: 'q1' }],
      total: 1,
    });
    const req = { user: { id: 7 }, query: { limit: '10' } };
    const res = makeRes();
    await getDue(req, res);
    expect(reviewService.getDueItems).toHaveBeenCalledWith(7, expect.objectContaining({ limit: '10' }));
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { items: [{ questionId: 'q1' }], total: 1 },
    });
  });

  it('forwards certificationId param', async () => {
    reviewService.getDueItems.mockResolvedValue({ items: [], total: 0 });
    const req = { user: { id: 7 }, query: { certificationId: '5' } };
    const res = makeRes();
    await getDue(req, res);
    expect(reviewService.getDueItems).toHaveBeenCalledWith(7, expect.objectContaining({ certificationId: '5' }));
  });

  it('returns 500 on service failure', async () => {
    reviewService.getDueItems.mockRejectedValue(new Error('boom'));
    const req = { user: { id: 1 }, query: {} };
    const res = makeRes();
    await getDue(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('reviewController.getStats', () => {
  it('returns 401 for anonymous users', async () => {
    const req = { user: null };
    const res = makeRes();
    await getStats(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns the data envelope on success', async () => {
    reviewService.getStats.mockResolvedValue({
      totalCards: 10, dueNow: 3, reviewed24h: 5, averageEase: 2.4, totalLapses: 1,
    });
    const req = { user: { id: 1 } };
    const res = makeRes();
    await getStats(req, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ totalCards: 10, dueNow: 3 }),
    });
  });
});

describe('reviewController.gradeReview', () => {
  it('returns 401 for anonymous users', async () => {
    const req = { user: null, params: { questionId: 'q1' }, body: { quality: 2 } };
    const res = makeRes();
    await gradeReview(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 for bad quality (BAD_REQUEST error from service)', async () => {
    reviewService.gradeReview.mockRejectedValue(
      Object.assign(new Error('quality must be 0..3'), { statusCode: 400 })
    );
    const req = { user: { id: 1 }, params: { questionId: 'q1' }, body: { quality: 99 } };
    const res = makeRes();
    await gradeReview(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns updated review on success', async () => {
    reviewService.gradeReview.mockResolvedValue({
      questionId: 'q1', easeFactor: 2.5, intervalDays: 1, repetitions: 1,
      lapses: 0, dueAt: new Date(), lastQuality: 2,
    });
    const req = { user: { id: 1 }, params: { questionId: 'q1' }, body: { quality: 'good' } };
    const res = makeRes();
    await gradeReview(req, res);
    expect(reviewService.gradeReview).toHaveBeenCalledWith(1, 'q1', 'good');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ questionId: 'q1' }),
    });
  });

  it('returns 500 on unexpected error', async () => {
    reviewService.gradeReview.mockRejectedValue(new Error('db down'));
    const req = { user: { id: 1 }, params: { questionId: 'q1' }, body: { quality: 2 } };
    const res = makeRes();
    await gradeReview(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
