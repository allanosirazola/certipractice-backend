/**
 * @fileoverview Exam Controller Tests
 */

// Mock dependencies before requiring the controller
jest.mock('../../../src/services/examService');
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

const ExamService = require('../../../src/services/examService');

describe('ExamController', () => {
  let mockReq;
  let mockRes;
  let examController;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Clear the module cache to get fresh mocks
    jest.resetModules();
    
    mockReq = {
      user: { id: 1, username: 'testuser' },
      body: {},
      query: {},
      params: { id: 'exam-123' },
      sessionId: 'session-123',
      headers: {}
    };

    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn()
    };

    // Mock pool for examService
    ExamService.pool = {
      connect: jest.fn().mockResolvedValue({
        query: jest.fn(),
        release: jest.fn()
      }),
      query: jest.fn()
    };

    examController = require('../../../src/controllers/examController');
  });

  describe('createExam', () => {
    it('should create exam with valid data', async () => {
      mockReq.body = {
        provider: 'Amazon',
        certification: 'AWS-SAA',
        mode: 'practice',
        questionCount: 20
      };

      const mockExam = {
        id: 'exam-123',
        toJSON: () => ({
          id: 'exam-123',
          provider: 'Amazon',
          certification: 'AWS-SAA',
          status: 'pending'
        })
      };

      ExamService.createExam.mockResolvedValue(mockExam);

      await examController.createExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            id: 'exam-123'
          })
        })
      );
    });

    it('should reject exam without provider', async () => {
      mockReq.body = {
        certification: 'AWS-SAA'
      };

      await examController.createExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false
        })
      );
    });

    it('should handle anonymous users with sessionId', async () => {
      mockReq.user = null;
      mockReq.sessionId = 'anon-session-123';
      mockReq.body = {
        provider: 'Amazon',
        certification: 'AWS-SAA'
      };

      const mockExam = {
        id: 'exam-123',
        toJSON: () => ({ id: 'exam-123' })
      };

      ExamService.createExam.mockResolvedValue(mockExam);

      await examController.createExam(mockReq, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Session-Id', 'anon-session-123');
    });
  });

  describe('cancelExam', () => {
    it('should cancel active exam', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'active',
        belongsTo: jest.fn().mockReturnValue(true)
      };

      const mockClient = {
        query: jest.fn().mockResolvedValue({}),
        release: jest.fn()
      };

      ExamService.getExamById.mockResolvedValue(mockExam);
      ExamService.pool.connect.mockResolvedValue(mockClient);

      await examController.cancelExam(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Exam cancelled successfully',
          data: expect.objectContaining({
            status: 'cancelled'
          })
        })
      );
    });

    it('should not cancel completed exam', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'completed',
        belongsTo: jest.fn().mockReturnValue(true)
      };

      ExamService.getExamById.mockResolvedValue(mockExam);

      await examController.cancelExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Cannot cancel')
        })
      );
    });

    it('should return 404 for non-existent exam', async () => {
      ExamService.getExamById.mockResolvedValue(null);

      await examController.cancelExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 403 for unauthorized access', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'active',
        belongsTo: jest.fn().mockReturnValue(false)
      };

      ExamService.getExamById.mockResolvedValue(mockExam);

      await examController.cancelExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });

  describe('toggleQuestionFlag', () => {
    it('should toggle flag on question', async () => {
      mockReq.params.questionId = 'question-123';

      const mockExam = {
        id: 'exam-123',
        status: 'active',
        belongsTo: jest.fn().mockReturnValue(true)
      };

      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'eq-123', is_flagged: false }] })
          .mockResolvedValueOnce({ rows: [{ is_flagged: true }] }),
        release: jest.fn()
      };

      ExamService.getExamById.mockResolvedValue(mockExam);
      ExamService.pool.connect.mockResolvedValue(mockClient);

      await examController.toggleQuestionFlag(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            isFlagged: true
          })
        })
      );
    });

    it('should require questionId', async () => {
      mockReq.params.questionId = undefined;
      mockReq.body.questionId = undefined;

      await examController.toggleQuestionFlag(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Question ID is required'
        })
      );
    });

    it('should only flag in active exams', async () => {
      mockReq.params.questionId = 'question-123';

      const mockExam = {
        id: 'exam-123',
        status: 'completed',
        belongsTo: jest.fn().mockReturnValue(true)
      };

      ExamService.getExamById.mockResolvedValue(mockExam);

      await examController.toggleQuestionFlag(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Can only flag questions in active exams'
        })
      );
    });
  });

  describe('pauseExam', () => {
    it('should pause active exam', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'in_progress',
        belongsTo: jest.fn().mockReturnValue(true)
      };

      const mockClient = {
        query: jest.fn().mockResolvedValue({}),
        release: jest.fn()
      };

      ExamService.getExamById.mockResolvedValue(mockExam);
      ExamService.pool.connect.mockResolvedValue(mockClient);

      await examController.pauseExam(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Exam paused successfully'
        })
      );
    });

    it('should not pause already paused exam', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'paused',
        belongsTo: jest.fn().mockReturnValue(true)
      };

      ExamService.getExamById.mockResolvedValue(mockExam);

      await examController.pauseExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('resumeExam', () => {
    it('should resume paused exam', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'paused',
        belongsTo: jest.fn().mockReturnValue(true),
        isTimeExpired: jest.fn().mockReturnValue(false),
        getSummary: jest.fn().mockReturnValue({}),
        getTimeRemaining: jest.fn().mockReturnValue(300)
      };

      const mockClient = {
        query: jest.fn().mockResolvedValue({}),
        release: jest.fn()
      };

      ExamService.getExamById
        .mockResolvedValueOnce(mockExam)
        .mockResolvedValueOnce(mockExam);
      ExamService.pool.connect.mockResolvedValue(mockClient);

      await examController.resumeExam(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Exam resumed successfully'
        })
      );
    });

    it('should not resume expired exam', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'paused',
        belongsTo: jest.fn().mockReturnValue(true),
        isTimeExpired: jest.fn().mockReturnValue(true)
      };

      ExamService.getExamById.mockResolvedValue(mockExam);

      await examController.resumeExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Exam time has expired and cannot be resumed'
        })
      );
    });
  });

  describe('getExamStatistics', () => {
    it('should return exam statistics', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'completed',
        title: 'AWS SAA Practice',
        score: 85,
        passed: true,
        timeSpent: 45,
        timeLimit: 60,
        belongsTo: jest.fn().mockReturnValue(true),
        getResults: jest.fn().mockReturnValue({
          totalQuestions: 20,
          correctAnswers: 17,
          incorrectAnswers: 3,
          unansweredQuestions: 0,
          categoryStats: [],
          difficultyStats: [],
          efficiency: 'good'
        }),
        getProgress: jest.fn().mockReturnValue({
          accuracyPercentage: 85
        })
      };

      ExamService.getExamById.mockResolvedValue(mockExam);

      await examController.getExamStatistics(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            overview: expect.objectContaining({
              examId: 'exam-123',
              score: 85,
              passed: true
            }),
            performance: expect.objectContaining({
              totalQuestions: 20,
              correctAnswers: 17
            })
          })
        })
      );
    });
  });
});
