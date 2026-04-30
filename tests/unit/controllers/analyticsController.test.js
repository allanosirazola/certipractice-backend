/**
 * @fileoverview Analytics Controller Tests
 */

const { mockPrisma, resetMocks } = require('../../mocks/prisma.mock');

// Mock dependencies
jest.mock('../../../src/database/pool', () => ({
  query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

const pool = require('../../../src/database/pool');
const {
  getUserProgress,
  getUserStats,
  getRecommendations,
  trackActivity
} = require('../../../src/controllers/analyticsController');

describe('AnalyticsController', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    jest.clearAllMocks();
    
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
  });

  describe('getUserProgress', () => {
    it('should return user progress data', async () => {
      const mockOverall = {
        rows: [{
          total_exams: '10',
          completed_exams: '8',
          passed_exams: '6',
          average_score: '75.5',
          unique_questions_attempted: '100',
          unique_questions_correct: '75'
        }]
      };

      const mockByCertification = {
        rows: [{
          certification_id: 1,
          certification_name: 'AWS SAA',
          provider_name: 'Amazon',
          total_exams: '5',
          completed_exams: '4',
          passed_exams: '3',
          average_score: '80',
          questions_attempted: '50',
          questions_correct: '40',
          total_questions: '100'
        }]
      };

      const mockRecentActivity = { rows: [] };
      const mockWeeklyProgress = { rows: [] };

      pool.query
        .mockResolvedValueOnce(mockOverall)
        .mockResolvedValueOnce(mockByCertification)
        .mockResolvedValueOnce(mockRecentActivity)
        .mockResolvedValueOnce(mockWeeklyProgress);

      await getUserProgress(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            overall: expect.objectContaining({
              totalExams: 10,
              completedExams: 8,
              passedExams: 6
            }),
            byCertification: expect.any(Array)
          })
        })
      );
    });

    it('should handle errors gracefully', async () => {
      pool.query.mockRejectedValue(new Error('Database error'));

      await getUserProgress(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Failed to get user progress'
        })
      );
    });
  });

  describe('getUserStats', () => {
    it('should return detailed user statistics', async () => {
      const mockStats = {
        rows: [{
          total_exams: '10',
          completed_exams: '8',
          passed_exams: '6',
          active_exams: '1',
          average_score: '75.5',
          best_score: '95',
          worst_score: '55',
          total_answers: '200',
          correct_answers: '150',
          incorrect_answers: '50',
          total_time_spent: '3600',
          average_time_per_question: '18',
          days_active_last_30: '15'
        }]
      };

      const mockDifficulty = {
        rows: [
          { difficulty: 'easy', total_attempts: '50', correct: '45', accuracy: '90.0' },
          { difficulty: 'medium', total_attempts: '100', correct: '70', accuracy: '70.0' },
          { difficulty: 'hard', total_attempts: '50', correct: '25', accuracy: '50.0' }
        ]
      };

      const mockTopics = { rows: [] };

      pool.query
        .mockResolvedValueOnce(mockStats)
        .mockResolvedValueOnce(mockDifficulty)
        .mockResolvedValueOnce(mockTopics);

      await getUserStats(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            exams: expect.objectContaining({
              total: 10,
              completed: 8,
              passed: 6
            }),
            scores: expect.objectContaining({
              average: '75.5',
              best: '95.0'
            }),
            questions: expect.objectContaining({
              totalAnswered: 200,
              correct: 150
            }),
            byDifficulty: expect.any(Array)
          })
        })
      );
    });
  });

  describe('getRecommendations', () => {
    it('should return learning recommendations', async () => {
      const mockWeakAreas = {
        rows: [{
          topic_id: 1,
          topic_name: 'S3',
          certification_id: 1,
          certification_name: 'AWS SAA',
          provider_name: 'Amazon',
          total_attempts: '20',
          correct: '8',
          accuracy: '40.0',
          available_questions: '50'
        }]
      };

      const mockUntouchedTopics = { rows: [] };
      const mockRetryQuestions = { rows: [] };
      const mockSuggestedActions = {
        rows: [{
          certification_id: 1,
          certification_name: 'AWS SAA',
          provider_name: 'Amazon',
          exams_taken: '5',
          average_score: '70',
          suggested_action: 'review_weak_areas'
        }]
      };

      pool.query
        .mockResolvedValueOnce(mockWeakAreas)
        .mockResolvedValueOnce(mockUntouchedTopics)
        .mockResolvedValueOnce(mockRetryQuestions)
        .mockResolvedValueOnce(mockSuggestedActions);

      await getRecommendations(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            weakAreas: expect.any(Array),
            untouchedTopics: expect.any(Array),
            questionsToRetry: expect.any(Array),
            certificationSuggestions: expect.any(Array)
          })
        })
      );
    });
  });

  describe('trackActivity', () => {
    it('should track valid activity', async () => {
      mockReq.body = {
        activityType: 'page_view',
        metadata: { page: '/dashboard' }
      };

      pool.query.mockResolvedValue({ rows: [{ id: 1 }] });

      await trackActivity(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            tracked: true
          })
        })
      );
    });

    it('should reject invalid activity type', async () => {
      mockReq.body = {
        activityType: 'invalid_type'
      };

      await trackActivity(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid activity type'
        })
      );
    });

    it('should require activity type', async () => {
      mockReq.body = {};

      await trackActivity(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Activity type is required'
        })
      );
    });

    it('should handle tracking errors gracefully', async () => {
      mockReq.body = {
        activityType: 'page_view'
      };

      pool.query.mockRejectedValue(new Error('Database error'));

      await trackActivity(mockReq, mockRes);

      // Should not fail even with DB error
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: { tracked: false }
        })
      );
    });
  });
});
