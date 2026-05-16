/**
 * @fileoverview Daily Quiz Controller unit tests
 */

jest.mock('../../../src/services/dailyQuizService', () => ({
  getDailyQuiz: jest.fn(),
  submitDailyQuiz: jest.fn(),
  hasCompletedToday: jest.fn(),
}));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const svc = require('../../../src/services/dailyQuizService');
const { getDaily, submitDaily, getStatus } = require('../../../src/controllers/dailyQuizController');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
beforeEach(() => jest.clearAllMocks());

describe('getDaily', () => {
  it('returns the quiz envelope for anon', async () => {
    svc.getDailyQuiz.mockResolvedValue({ date: '2026-05-20', questions: [], completed: false, previousScore: null });
    const req = { user: null };
    const res = makeRes();
    await getDaily(req, res);
    expect(svc.getDailyQuiz).toHaveBeenCalledWith(null);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
  it('passes userId for authed', async () => {
    svc.getDailyQuiz.mockResolvedValue({ date: 'd', questions: [], completed: false });
    const req = { user: { id: 7 } };
    const res = makeRes();
    await getDaily(req, res);
    expect(svc.getDailyQuiz).toHaveBeenCalledWith(7);
  });
  it('returns 500 on service failure', async () => {
    svc.getDailyQuiz.mockRejectedValue(new Error('boom'));
    const res = makeRes();
    await getDaily({ user: null }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('submitDaily', () => {
  it('returns 401 for anon', async () => {
    const res = makeRes();
    await submitDaily({ user: null, body: { answers: [] } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(svc.submitDailyQuiz).not.toHaveBeenCalled();
  });
  it('returns 400 for bad answers', async () => {
    svc.submitDailyQuiz.mockRejectedValue(Object.assign(new Error('bad'), { statusCode: 400 }));
    const res = makeRes();
    await submitDaily({ user: { id: 1 }, body: { answers: [] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it('returns score on success', async () => {
    svc.submitDailyQuiz.mockResolvedValue({ score: 4, total: 5, alreadyCompleted: false });
    const res = makeRes();
    await submitDaily({ user: { id: 1 }, body: { answers: [{ questionId: 'q', isCorrect: true }] } }, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { score: 4, total: 5, alreadyCompleted: false },
    });
  });
  it('returns 500 on unexpected error', async () => {
    svc.submitDailyQuiz.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await submitDaily({ user: { id: 1 }, body: { answers: [{}] } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('getStatus', () => {
  it('returns completed=false + authenticated=false for anon', async () => {
    const res = makeRes();
    await getStatus({ user: null }, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { completed: false, authenticated: false },
    });
  });
  it('returns completed flag for authed', async () => {
    svc.hasCompletedToday.mockResolvedValue(true);
    const res = makeRes();
    await getStatus({ user: { id: 7 } }, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { completed: true, authenticated: true },
    });
  });
});
