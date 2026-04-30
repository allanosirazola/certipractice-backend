/**
 * @fileoverview User Controller Tests
 */

jest.mock('../../../src/services/userService');
jest.mock('../../../src/services/examService');
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

const UserService = require('../../../src/services/userService');
const ExamService = require('../../../src/services/examService');

describe('UserController', () => {
  let mockReq;
  let mockRes;
  let userController;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock pool for ExamService
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
      UserService.getUserStats.mockResolvedValue(mockStats);

      await userController.getUserStats(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockStats
        })
      );
    });

    it('should handle errors', async () => {
      UserService.getUserStats.mockRejectedValue(new Error('DB error'));

      await userController.getUserStats(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getUserProgress', () => {
    it('should return user progress', async () => {
      const mockProgress = { completion: 75 };
      UserService.getUserProgress.mockResolvedValue(mockProgress);

      await userController.getUserProgress(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockProgress
        })
      );
    });

    it('should pass certificationId filter', async () => {
      mockReq.query.certificationId = '123';
      UserService.getUserProgress.mockResolvedValue({});

      await userController.getUserProgress(mockReq, mockRes);

      expect(UserService.getUserProgress).toHaveBeenCalledWith(1, '123');
    });
  });

  describe('getFailedQuestions', () => {
    it('should return failed questions list', async () => {
      const mockFailedQuestions = {
        rows: [
          { id: 'q1', text: 'Question 1', failed_count: 3 },
          { id: 'q2', text: 'Question 2', failed_count: 2 }
        ]
      };

      ExamService.pool.query.mockResolvedValue(mockFailedQuestions);

      await userController.getFailedQuestions(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
          count: 2
        })
      );
    });

    it('should filter by provider', async () => {
      mockReq.query.provider = 'Amazon';
      ExamService.pool.query.mockResolvedValue({ rows: [] });

      await userController.getFailedQuestions(mockReq, mockRes);

      expect(ExamService.pool.query).toHaveBeenCalledWith(
        expect.stringContaining('p.name'),
        expect.arrayContaining(['Amazon'])
      );
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
            totalFailedQuestions: 25,
            byCategory: expect.any(Array),
            byDifficulty: expect.any(Array),
            topFailed: expect.any(Array),
            hasEnoughForExam: true
          })
        })
      );
    });
  });

  describe('getFailedQuestionsProgress', () => {
    it('should return progress over time', async () => {
      ExamService.pool.query
        .mockResolvedValueOnce({ 
          rows: [
            { date: '2024-01-01', failed_questions: '5', correct_questions: '10' }
          ] 
        })
        .mockResolvedValueOnce({ 
          rows: [{ total_failed: '20', improved: '15', still_struggling: '5' }] 
        });

      await userController.getFailedQuestionsProgress(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            dailyProgress: expect.any(Array),
            improvement: expect.objectContaining({
              totalFailed: 20,
              improved: 15
            })
          })
        })
      );
    });

    it('should handle timeframe parameter', async () => {
      mockReq.query.timeframe = 'week';
      ExamService.pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_failed: 0, improved: 0, still_struggling: 0 }] });

      await userController.getFailedQuestionsProgress(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timeframe: 'week'
          })
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
        expect.objectContaining({
          success: true,
          message: 'Question marked as failed',
          data: expect.objectContaining({
            questionId: 'q-123'
          })
        })
      );
    });

    it('should require questionId', async () => {
      mockReq.body = {};

      await userController.markQuestionAsFailed(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Question ID is required'
        })
      );
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
        expect.objectContaining({
          success: true,
          message: 'Question removed from failed list'
        })
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
        .mockResolvedValueOnce({ 
          rows: [{ 
            topic_id: 1, 
            topic_name: 'S3', 
            certification_name: 'AWS SAA',
            accuracy: '45.0',
            total_attempts: '20',
            available_questions: '50'
          }] 
        })
        .mockResolvedValueOnce({ 
          rows: [{ 
            topic_id: 2, 
            topic_name: 'EC2', 
            accuracy: '40.0',
            recommended_questions: '20'
          }] 
        })
        .mockResolvedValueOnce({ 
          rows: [{ 
            average_score: '70',
            exams_taken: '5',
            exams_passed: '3'
          }] 
        });

      await userController.getStudyRecommendations(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            weakTopics: expect.any(Array),
            recommendedPractice: expect.any(Array),
            readiness: expect.objectContaining({
              score: expect.any(Number),
              recommendation: expect.any(String)
            })
          })
        })
      );
    });
  });

  describe('getAllUsers (Admin)', () => {
    it('should return paginated users for admin', async () => {
      mockReq.user.role = 'admin';
      
      const mockUsers = [
        { toJSON: () => ({ id: 1, username: 'user1' }) },
        { toJSON: () => ({ id: 2, username: 'user2' }) }
      ];

      UserService.getAllUsers.mockResolvedValue({
        users: mockUsers,
        pagination: { page: 1, limit: 10, total: 2 }
      });

      await userController.getAllUsers(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
          pagination: expect.any(Object)
        })
      );
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

      const mockUser = {
        toJSON: () => ({ id: 2, role: 'instructor' })
      };

      UserService.changeUserRole.mockResolvedValue(mockUser);

      await userController.updateUserRole(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'User role updated successfully'
        })
      );
    });

    it('should prevent admin from demoting themselves', async () => {
      mockReq.user.role = 'admin';
      mockReq.user.id = 1;
      mockReq.params.id = '1';
      mockReq.body.role = 'student';

      await userController.updateUserRole(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('cannot change your own')
        })
      );
    });

    it('should reject invalid roles', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.id = '2';
      mockReq.body.role = 'superadmin';

      await userController.updateUserRole(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Invalid role')
        })
      );
    });
  });

  describe('activateUser / deactivateUser', () => {
    it('should activate user', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.id = '2';

      const mockUser = {
        toJSON: () => ({ id: 2, is_active: true })
      };

      UserService.activateUser.mockResolvedValue(mockUser);

      await userController.activateUser(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'User activated successfully'
        })
      );
    });

    it('should deactivate user', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.id = '2';

      const mockUser = {
        toJSON: () => ({ id: 2, is_active: false })
      };

      UserService.deactivateUser.mockResolvedValue(mockUser);

      await userController.deactivateUser(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'User deactivated successfully'
        })
      );
    });

    it('should prevent admin from deactivating themselves', async () => {
      mockReq.user.role = 'admin';
      mockReq.user.id = 1;
      mockReq.params.id = '1';

      await userController.deactivateUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('resetUserPassword', () => {
    it('should reset user password', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.id = '2';
      mockReq.body.newPassword = 'NewSecurePass123!';

      UserService.resetUserPassword.mockResolvedValue({});

      await userController.resetUserPassword(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Password reset successfully'
        })
      );
    });

    it('should require newPassword', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.id = '2';
      mockReq.body = {};

      await userController.resetUserPassword(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'New password is required'
        })
      );
    });
  });

  describe('getUsersByRole', () => {
    it('should return users by role', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.role = 'instructor';

      const mockUsers = [
        { toJSON: () => ({ id: 1, role: 'instructor' }) }
      ];

      UserService.getUsersByRole.mockResolvedValue(mockUsers);

      await userController.getUsersByRole(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array)
        })
      );
    });

    it('should reject invalid role', async () => {
      mockReq.user.role = 'admin';
      mockReq.params.role = 'invalid';

      await userController.getUsersByRole(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });
});
