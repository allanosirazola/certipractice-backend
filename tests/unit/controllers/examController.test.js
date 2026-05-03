/**
 * @fileoverview Exam Controller Tests
 */

jest.mock('../../../src/services/examService');
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('ExamController', () => {
  let mockReq;
  let mockRes;
  let examController;
  let ExamService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    ExamService = require('../../../src/services/examService');
    
    // Mock pool
    ExamService.pool = {
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn()
      }),
      query: jest.fn()
    };

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

    examController = require('../../../src/controllers/examController');
  });

  describe('createExam', () => {
    it('should create exam with valid data', async () => {
      mockReq.body = { provider: 'Amazon', certification: 'AWS-SAA', mode: 'practice' };

      const mockExam = {
        id: 'exam-123',
        toJSON: () => ({ id: 'exam-123', provider: 'Amazon', status: 'pending' })
      };

      ExamService.createExam = jest.fn().mockResolvedValue(mockExam);

      await examController.createExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should reject exam without provider', async () => {
      mockReq.body = { certification: 'AWS-SAA' };

      await examController.createExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('cancelExam', () => {
    it('should cancel active exam', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'active',
        belongsTo: jest.fn().mockReturnValue(true)
      };

      ExamService.getExamById = jest.fn().mockResolvedValue(mockExam);

      await examController.cancelExam(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Exam cancelled successfully' })
      );
    });

    it('should not cancel completed exam', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'completed',
        belongsTo: jest.fn().mockReturnValue(true)
      };

      ExamService.getExamById = jest.fn().mockResolvedValue(mockExam);

      await examController.cancelExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 for non-existent exam', async () => {
      ExamService.getExamById = jest.fn().mockResolvedValue(null);

      await examController.cancelExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 403 for unauthorized access', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'active',
        belongsTo: jest.fn().mockReturnValue(false)
      };

      ExamService.getExamById = jest.fn().mockResolvedValue(mockExam);

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

      ExamService.getExamById = jest.fn().mockResolvedValue(mockExam);
      ExamService.pool.connect = jest.fn().mockResolvedValue(mockClient);

      await examController.toggleQuestionFlag(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ isFlagged: true }) })
      );
    });

    it('should require questionId', async () => {
      mockReq.params.questionId = undefined;
      mockReq.body.questionId = undefined;

      await examController.toggleQuestionFlag(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should only flag in active exams', async () => {
      mockReq.params.questionId = 'question-123';

      const mockExam = {
        id: 'exam-123',
        status: 'completed',
        belongsTo: jest.fn().mockReturnValue(true)
      };

      ExamService.getExamById = jest.fn().mockResolvedValue(mockExam);

      await examController.toggleQuestionFlag(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('pauseExam', () => {
    it('should pause active exam', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'in_progress',
        belongsTo: jest.fn().mockReturnValue(true)
      };

      ExamService.getExamById = jest.fn().mockResolvedValue(mockExam);

      await examController.pauseExam(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Exam paused successfully' })
      );
    });

    it('should not pause already paused exam', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'paused',
        belongsTo: jest.fn().mockReturnValue(true)
      };

      ExamService.getExamById = jest.fn().mockResolvedValue(mockExam);

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

      ExamService.getExamById = jest.fn()
        .mockResolvedValueOnce(mockExam)
        .mockResolvedValueOnce(mockExam);

      await examController.resumeExam(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Exam resumed successfully' })
      );
    });

    it('should not resume expired exam', async () => {
      const mockExam = {
        id: 'exam-123',
        status: 'paused',
        belongsTo: jest.fn().mockReturnValue(true),
        isTimeExpired: jest.fn().mockReturnValue(true)
      };

      ExamService.getExamById = jest.fn().mockResolvedValue(mockExam);

      await examController.resumeExam(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
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
        getProgress: jest.fn().mockReturnValue({ accuracyPercentage: 85 })
      };

      ExamService.getExamById = jest.fn().mockResolvedValue(mockExam);

      await examController.getExamStatistics(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            overview: expect.objectContaining({ examId: 'exam-123', score: 85 })
          })
        })
      );
    });
  });
});
