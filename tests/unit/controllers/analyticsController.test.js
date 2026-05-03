/**
 * @fileoverview Analytics Controller Tests
 */

jest.mock('../../../src/database/pool', () => ({
  query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('AnalyticsController', () => {
  let mockReq;
  let mockRes;
  let pool;
  let analyticsController;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    pool = require('../../../src/database/pool');

    mockReq = {
      user: { id: 1, username: 'testuser' },
      body: {},
      query: {},
      params: {},
      headers: { 'x-session-id': 'test-session' },
      ip: '127.0.0.1'
    };

    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    analyticsController = require('../../../src/controllers/analyticsController');
  });

  describe('getUserProgress', () => {
    it('should return user progress data', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ total_exams: '10', completed_exams: '8', passed_exams: '6', average_score: '75.5', unique_questions_attempted: '100', unique_questions_correct: '75' }] })
        .mockResolvedValueOnce({ rows: [{ certification_id: 1, certification_name: 'AWS', provider_name: 'Amazon', total_exams: '5', completed_exams: '4', passed_exams: '3', average_score: '80', questions_attempted: '50', questions_correct: '40', total_questions: '100' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await analyticsController.getUserProgress(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            overall: expect.objectContaining({ totalExams: 10, completedExams: 8 })
          })
        })
      );
    });

    it('should handle errors gracefully', async () => {
      pool.query.mockRejectedValue(new Error('Database error'));

      await analyticsController.getUserProgress(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getUserStats', () => {
    it('should return detailed user statistics', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ total_exams: '10', completed_exams: '8', passed_exams: '6', active_exams: '1', average_score: '75.5', best_score: '95', worst_score: '55', total_answers: '200', correct_answers: '150', incorrect_answers: '50', total_time_spent: '3600', average_time_per_question: '18', days_active_last_30: '15' }] })
        .mockResolvedValueOnce({ rows: [{ difficulty: 'easy', total_attempts: '50', correct: '45', accuracy: '90.0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await analyticsController.getUserStats(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            exams: expect.objectContaining({ total: 10, completed: 8 })
          })
        })
      );
    });
  });

  describe('getRecommendations', () => {
    it('should return learning recommendations', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ topic_id: 1, topic_name: 'S3', certification_id: 1, certification_name: 'AWS', provider_name: 'Amazon', total_attempts: '20', correct: '8', accuracy: '40.0', available_questions: '50' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ certification_id: 1, certification_name: 'AWS', provider_name: 'Amazon', exams_taken: '5', average_score: '70', suggested_action: 'review_weak_areas' }] });

      await analyticsController.getRecommendations(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            weakAreas: expect.any(Array)
          })
        })
      );
    });
  });

  describe('trackActivity', () => {
    it('should track valid activity', async () => {
      mockReq.body = { activityType: 'page_view', metadata: { page: '/dashboard' } };
      pool.query.mockResolvedValue({ rows: [{ id: 1 }] });

      await analyticsController.trackActivity(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ tracked: true }) })
      );
    });

    it('should reject invalid activity type', async () => {
      mockReq.body = { activityType: 'invalid_type' };

      await analyticsController.trackActivity(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should require activity type', async () => {
      mockReq.body = {};

      await analyticsController.trackActivity(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should handle tracking errors gracefully', async () => {
      mockReq.body = { activityType: 'page_view' };
      pool.query.mockRejectedValue(new Error('Database error'));

      await analyticsController.trackActivity(mockReq, mockRes);

      // Should not fail even with DB error
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: { tracked: false } })
      );
    });
  });
});
