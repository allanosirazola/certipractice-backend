/**
 * @fileoverview Tests for progressController.
 */

jest.mock('../../../src/services/progressService', () => ({
  getStreak: jest.fn(),
  getReadiness: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const progressService = require('../../../src/services/progressService');
const { getStreak, getReadiness } = require('../../../src/controllers/progressController');

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('progressController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getStreak', () => {
    it('returns the data envelope from the service', async () => {
      const req = { user: { id: 1 } };
      const res = mockRes();
      const payload = { currentStreak: 7, longestStreak: 12 };
      progressService.getStreak.mockResolvedValue(payload);

      await getStreak(req, res);

      expect(progressService.getStreak).toHaveBeenCalledWith(1);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: payload });
    });

    it('returns 500 on service error', async () => {
      progressService.getStreak.mockRejectedValue(new Error('boom'));
      const res = mockRes();
      await getStreak({ user: { id: 1 } }, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getReadiness', () => {
    it('returns data when input is valid', async () => {
      const payload = { ready: true, probability: 0.92 };
      progressService.getReadiness.mockResolvedValue(payload);
      const res = mockRes();
      await getReadiness(
        { user: { id: 1 }, params: { certificationId: '42' } },
        res
      );
      expect(progressService.getReadiness).toHaveBeenCalledWith(1, 42);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: payload });
    });

    it('returns 400 for non-numeric certificationId', async () => {
      const res = mockRes();
      await getReadiness(
        { user: { id: 1 }, params: { certificationId: 'abc' } },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(progressService.getReadiness).not.toHaveBeenCalled();
    });

    it('returns 400 for negative certificationId', async () => {
      const res = mockRes();
      await getReadiness(
        { user: { id: 1 }, params: { certificationId: '-5' } },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 on service error', async () => {
      progressService.getReadiness.mockRejectedValue(new Error('db'));
      const res = mockRes();
      await getReadiness(
        { user: { id: 1 }, params: { certificationId: '1' } },
        res
      );
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
