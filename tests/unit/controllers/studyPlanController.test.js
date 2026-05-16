/**
 * @fileoverview studyPlanController unit tests
 */

jest.mock('../../../src/services/studyPlanService', () => ({
  createPlan: jest.fn(),
  listActivePlans: jest.fn(),
  getActivePlanForCertification: jest.fn(),
  cancelPlan: jest.fn(),
}));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const svc = require('../../../src/services/studyPlanService');
const { createStudyPlan, listActive, getForCertification, cancelPlan } = require('../../../src/controllers/studyPlanController');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
beforeEach(() => jest.clearAllMocks());

describe('createStudyPlan', () => {
  it('returns 401 for anon', async () => {
    const res = makeRes();
    await createStudyPlan({ user: null, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('returns 201 + data on success', async () => {
    svc.createPlan.mockResolvedValue({ id: 1, dailyGoal: 15 });
    const res = makeRes();
    await createStudyPlan({ user: { id: 1 }, body: { certificationId: 5, targetDate: '2099-01-01' } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
  it('forwards 400 from service', async () => {
    svc.createPlan.mockRejectedValue(Object.assign(new Error('bad'), { statusCode: 400 }));
    const res = makeRes();
    await createStudyPlan({ user: { id: 1 }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it('returns 500 on unexpected error', async () => {
    svc.createPlan.mockRejectedValue(new Error('boom'));
    const res = makeRes();
    await createStudyPlan({ user: { id: 1 }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('listActive', () => {
  it('returns 401 for anon', async () => {
    const res = makeRes();
    await listActive({ user: null }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('returns items envelope', async () => {
    svc.listActivePlans.mockResolvedValue([{ id: 1 }]);
    const res = makeRes();
    await listActive({ user: { id: 1 } }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { items: [{ id: 1 }] } });
  });
});

describe('getForCertification', () => {
  it('returns 401 for anon', async () => {
    const res = makeRes();
    await getForCertification({ user: null, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('returns null when no plan', async () => {
    svc.getActivePlanForCertification.mockResolvedValue(null);
    const res = makeRes();
    await getForCertification({ user: { id: 1 }, params: { certificationId: '5' } }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: null });
  });
  it('forwards plan from service', async () => {
    svc.getActivePlanForCertification.mockResolvedValue({ id: 7 });
    const res = makeRes();
    await getForCertification({ user: { id: 1 }, params: { certificationId: '5' } }, res);
    expect(svc.getActivePlanForCertification).toHaveBeenCalledWith(1, 5);
  });
});

describe('cancelPlan', () => {
  it('returns 401 for anon', async () => {
    const res = makeRes();
    await cancelPlan({ user: null, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('returns cancelled=true on success', async () => {
    svc.cancelPlan.mockResolvedValue({ cancelled: true });
    const res = makeRes();
    await cancelPlan({ user: { id: 1 }, params: { planId: '7' } }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { cancelled: true } });
  });
  it('returns 400 from service', async () => {
    svc.cancelPlan.mockRejectedValue(Object.assign(new Error('bad'), { statusCode: 400 }));
    const res = makeRes();
    await cancelPlan({ user: { id: 1 }, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
