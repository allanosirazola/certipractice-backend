/**
 * @fileoverview User Controller Tests
 */

// Mock dependencies before requiring anything
jest.mock('../../../src/services/userService');
jest.mock('../../../src/services/examService');
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('UserController', () => {
  let mockReq;
  let mockRes;
  let userController;
  let UserService;
  let ExamService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Re-require mocked modules
    UserService = require('../../../src/services/userService');
    ExamService = require('../../../src/services/examService');
    
    // Setup ExamService.pool mock
    ExamService.pool = {
      query: jest.fn()
    };

    mockReq = {
      user: { id: 1, username: 'testuser', role: 'student' },
      body: {},
      query: {},
      params: {}
    };

    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    userController = require('../../../src/controllers/userController');
  });

  describe('getUserStats', () => {
    it('should return user statistics', async () => {
      const mockStats = { exams: 10, passed: 8 };
      UserService.getUserStats = jest.fn().mockResolvedValue(mockStats);

      await userController.getUserStats(mockReq, mockRes);

      expect(UserService.getUserStats).toHaveBeenCalledWith(1);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockStats
      });
    });

    it('should handle errors', async () => {
      UserService.getUserStats = jest.fn().mockRejectedValue(new Error('DB error'));

      await userController.getUserStats(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getUserProgress', () => {
    it('should return user progress', async () => {
      const mockProgress = { completion: 75 };
      UserService.getUserProgress = jest.fn().mockResolvedValue(mockProgress);

      await userController.getUserProgress(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockProgress
      });
    });

    it('should pass certificationId filter', async () => {
      mockReq.query.certificationId = '123';
      UserService.getUserProgress = jest.fn().mockResolvedValue({});

      await userController.getUserProgress(mockReq, mockRes);

      expect(UserService.getUserProgress).toHaveBeenCalledWith(1, '123');
    });
  });

  describe('getFailedQuestions', () => {
    it('should return failed questions list', async () => {
      const mockFailedQuestions = {
        rows: [
          { id: 'q1', text: 'Question 1', failed_count: '3' },
          { id: 'q2', text: 'Question 2', failed_count: '2' }
        ]
      };

      ExamService.pool.query.mockResolvedValue(mockFailedQuestions);

      await userController.getFailedQuestions(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          count: 2
        })
      );
    });

    it('should handle query errors', async () => {
      ExamService.pool.query.mockRejectedValue(new Error('DB error'));

      await userController.getFailedQuestions(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getFailedQuestionsStats', () => {
    it('should return failed questions statistics', async () => {
      ExamService.pool.query
        .mockResolvedValueOnce({ rows: [{ total_failed_questions: '25' }] })
        .mockResolvedValueOnce({ rows: [{ category: 'S3', failed_questions: '10' }] })
        .mockResolvedValueOnce({ rows: [{ difficulty: 'hard', failed_questions: '15' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'q1', text: 'Q1', failed_count: '5' }] });

      await userController.getFailedQuestionsStats(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            totalFailedQuestions: 25
          })
        })
      );
    });
  });

  describe('getFailedQuestionsProgress', () => {
    it('should return progress over time', async () => {
      ExamService.pool.query
        .mockResolvedValueOnce({ rows: [{ date: '2024-01-01', failed_questions: '5', correct_questions: '10' }] })
        .mockResolvedValueOnce({ rows: [{ total_failed: '20', improved: '15', still_struggling: '5' }] });

      await userController.getFailedQuestionsProgress(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ timeframe: 'month' })
        })
      );
    });
  });

  describe('markQuestionAsFailed', () => {
    it('should mark question as failed', async () => {
      mockReq.body.questionId = 'q-123';
      ExamService.pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'q-123' }] })
        .mockResolvedValueOnce({});

      await userController.markQuestionAsFailed(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Question marked as failed' })
      );
    });

    it('should require questionId', async () => {
      mockReq.body = {};
      await userController.markQuestionAsFailed(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 for non-existent question', async () => {
      mockReq.body.questionId = 'non-existent';
      ExamService.pool.query.mockResolvedValueOnce({ rows: [] });
      await userController.markQuestionAsFailed(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('removeFromFailedQuestions', () => {
    it('should remove question from failed list', async () => {
      mockReq.params.questionId = 'q-123';
      ExamService.pool.query.mockResolvedValue({});
      await userController.removeFromFailedQuestions(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Question removed from failed list' })
      );
    });

    it('should require questionId', async () => {
      mockReq.params.questionId = undefined;
      await userController.removeFromFailedQuestions(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('getStudyRecommendations', () => {
    it('should return study recommendations', async () => {
      ExamService.pool.query
        .mockResolvedValueOnce({ rows: [{ topic_id: 1, topic_name: 'S3', certification_name: 'AWS', accuracy: '45.0', total_attempts: '20', available_questions: '50' }] })
        .mockResolvedValueOnce({ rows: [{ topic_id: 2, topic_name: 'EC2', accuracy: '40.0', recommended_questions: '20' }] })
        .mockResolvedValueOnce({ rows: [{ average_score: '70', exams_taken: '5', exams_passed: '3' }] });

      await userController.getStudyRecommendations(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ weakTopics: expect.any(Array) }) })
      );
    });
  });

  describe('getAllUsers (Admin)', () => {
    it('should return paginated users for admin', async () => {
      mockReq.user.role = 'admin';
      const mockUsers = [{ toJSON: () => ({ id: 1 }) }];
      UserService.getAllUsers = jest.fn().mockResolvedValue({ users: mockUsers, pagination: { page: 1, limit: 10, total: 1 } });

      await userController.getAllUsers(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should deny access to non-admin', async () => {
      mockReq.user.role = 'student';
      await userController.getAllUsers(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });

  describe('updateUserRole (Admin)', () => {
    it('should update user role', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.id = '2';
      mockReq.body.role = 'instructor';
      UserService.changeUserRole = jest.fn().mockResolvedValue({ toJSON: () => ({ id: 2, role: 'instructor' }) });

      await userController.updateUserRole(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should prevent admin from demoting themselves', async () => {
      mockReq.user = { id: 1, role: 'admin' };
      mockReq.params.id = '1';
      mockReq.body.role = 'student';
      await userController.updateUserRole(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should reject invalid roles', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.id = '2';
      mockReq.body.role = 'superadmin';
      await userController.updateUserRole(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('activateUser / deactivateUser', () => {
    it('should activate user', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.id = '2';
      UserService.activateUser = jest.fn().mockResolvedValue({ toJSON: () => ({ id: 2, is_active: true }) });

      await userController.activateUser(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should deactivate user', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.id = '2';
      UserService.deactivateUser = jest.fn().mockResolvedValue({ toJSON: () => ({ id: 2, is_active: false }) });

      await userController.deactivateUser(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should prevent admin from deactivating themselves', async () => {
      mockReq.user = { id: 1, role: 'admin' };
      mockReq.params.id = '1';
      await userController.deactivateUser(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('resetUserPassword', () => {
    it('should reset user password', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.id = '2';
      mockReq.body.newPassword = 'NewPass123!';
      UserService.resetUserPassword = jest.fn().mockResolvedValue({});

      await userController.resetUserPassword(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should require newPassword', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.id = '2';
      mockReq.body = {};
      await userController.resetUserPassword(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('getUsersByRole', () => {
    it('should return users by role', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.role = 'instructor';
      UserService.getUsersByRole = jest.fn().mockResolvedValue([{ toJSON: () => ({ id: 1 }) }]);

      await userController.getUsersByRole(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should reject invalid role', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.role = 'invalid';
      await userController.getUsersByRole(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });
});
