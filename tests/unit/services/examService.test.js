/**
 * @fileoverview Exam Service Unit Tests - Simplified
 * Tests the business logic without complex database mocking
 */

// Mock logger first
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock config
jest.mock('../../../src/config/config', () => ({
  exam: {
    minQuestions: 5,
    maxQuestions: 200,
    defaultTimeLimit: 120,
    defaultPassingScore: 70,
    maxTimeLimit: 480,
  },
  bcrypt: { rounds: 4 },
}));

const Exam = require('../../../src/models/Exam');
const { generateQuestions } = require('../../fixtures');

describe('ExamService - Unit Logic', () => {
  describe('Exam Model Integration', () => {
    it('should validate exam configuration', () => {
      const validConfig = {
        provider: 1,
        certification: 1,
        mode: 'practice',
        questionCount: 10,
        timeLimit: 30,
      };

      const errors = Exam.validate(validConfig);
      expect(errors).toEqual([]);
    });

    it('should reject invalid exam configuration', () => {
      const invalidConfig = {
        provider: null,
        certification: null,
        mode: 'invalid',
      };

      const errors = Exam.validate(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Provider is required');
      expect(errors).toContain('Certification is required');
    });

    it('should validate question count limits', () => {
      const tooFew = Exam.validate({ provider: 1, certification: 1, questionCount: 2 });
      expect(tooFew.some(e => e.includes('at least'))).toBe(true);

      const tooMany = Exam.validate({ provider: 1, certification: 1, questionCount: 500 });
      expect(tooMany.some(e => e.includes('cannot exceed'))).toBe(true);
    });

    it('should validate time limit', () => {
      const tooShort = Exam.validate({ provider: 1, certification: 1, timeLimit: 0 });
      expect(tooShort.some(e => e.includes('at least 1 minute'))).toBe(true);

      const tooLong = Exam.validate({ provider: 1, certification: 1, timeLimit: 500 });
      expect(tooLong.some(e => e.includes('cannot exceed'))).toBe(true);
    });
  });

  describe('Score Calculation', () => {
    it('should calculate score correctly', () => {
      const exam = new Exam({
        questions: [
          { id: 1, correctAnswers: [0], points: 1 },
          { id: 2, correctAnswers: [1], points: 1 },
          { id: 3, correctAnswers: [2], points: 1 },
          { id: 4, correctAnswers: [0], points: 1 },
        ],
        answers: {
          1: 0, // Correct
          2: 1, // Correct
          3: 0, // Wrong
          4: 0, // Correct
        },
        passingScore: 70,
      });

      const score = exam.calculateScore();
      expect(score).toBe(75);
      expect(exam.passed).toBe(true);
    });

    it('should handle weighted scoring', () => {
      const exam = new Exam({
        questions: [
          { id: 1, correctAnswers: [0], points: 2 },
          { id: 2, correctAnswers: [1], points: 1 },
        ],
        answers: {
          1: 0, // Correct - 2 points
          2: 0, // Wrong - 0 points
        },
      });

      const score = exam.calculateScore();
      // 2 out of 3 total points = 66.67% (might be rounded to 67)
      expect(score).toBeGreaterThanOrEqual(66);
      expect(score).toBeLessThanOrEqual(67);
    });

    it('should handle empty exam', () => {
      const exam = new Exam({ questions: [], answers: {} });
      expect(exam.calculateScore()).toBe(0);
    });
  });

  describe('Answer Validation', () => {
    it('should validate single choice answers', () => {
      const exam = new Exam({
        questions: [{
          id: 1,
          isMultipleChoice: false,
          expectedAnswers: 1,
          options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
        }],
      });

      expect(exam.validateAnswer(1, 0)).toBe(0);
      expect(exam.validateAnswer(1, 3)).toBe(3);
    });

    it('should reject invalid answer indices', () => {
      const exam = new Exam({
        questions: [{
          id: 1,
          options: [{ label: 'A' }, { label: 'B' }],
        }],
      });

      expect(() => exam.validateAnswer(1, -1)).toThrow('Invalid answer');
      expect(() => exam.validateAnswer(1, 10)).toThrow('Invalid answer');
    });

    it('should validate multiple choice answers', () => {
      const exam = new Exam({
        questions: [{
          id: 1,
          isMultipleChoice: true,
          questionType: 'multiple_answer',
          expectedAnswers: 2,
          options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        }],
      });

      expect(exam.validateAnswer(1, [0, 1])).toEqual([0, 1]);
    });

    it('should remove duplicate answers', () => {
      const exam = new Exam({
        questions: [{
          id: 1,
          isMultipleChoice: true,
          expectedAnswers: 3,
          options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        }],
      });

      expect(exam.validateAnswer(1, [0, 0, 1])).toEqual([0, 1]);
    });
  });

  describe('Time Management', () => {
    it('should calculate remaining time', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const exam = new Exam({
        status: 'in_progress',
        timeLimit: 10,
        startedAt: fiveMinutesAgo.toISOString(),
      });

      const remaining = exam.getTimeRemaining();
      expect(remaining).toBeGreaterThan(290);
      expect(remaining).toBeLessThan(310);
    });

    it('should detect expired exams', () => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const exam = new Exam({
        status: 'in_progress',
        timeLimit: 10,
        startedAt: thirtyMinutesAgo.toISOString(),
      });

      expect(exam.isTimeExpired()).toBe(true);
      expect(exam.getTimeRemaining()).toBe(0);
    });

    it('should not be expired for non-started exams', () => {
      const exam = new Exam({ status: 'not_started', timeLimit: 10 });
      expect(exam.isTimeExpired()).toBe(false);
    });
  });

  describe('Progress Tracking', () => {
    it('should calculate progress correctly', () => {
      const exam = new Exam({
        questions: generateQuestions(10),
        answers: { 1: 0, 2: 1, 3: 2 },
      });

      const progress = exam.getProgress();
      expect(progress.totalQuestions).toBe(10);
      expect(progress.answeredQuestions).toBe(3);
      expect(progress.remainingQuestions).toBe(7);
      expect(progress.progressPercentage).toBe(30);
    });

    it('should handle empty progress', () => {
      const exam = new Exam({ questions: [], answers: {} });
      const progress = exam.getProgress();
      expect(progress.progressPercentage).toBe(0);
    });
  });

  describe('Ownership Checks', () => {
    it('should verify user ownership', () => {
      const exam = new Exam({ userId: 1 });
      expect(exam.belongsTo(1, null)).toBe(true);
      expect(exam.belongsTo(2, null)).toBe(false);
    });

    it('should verify session ownership', () => {
      const exam = new Exam({ sessionId: 'session-123' });
      expect(exam.belongsTo(null, 'session-123')).toBe(true);
      expect(exam.belongsTo(null, 'other-session')).toBe(false);
    });

    it('should match either user or session', () => {
      const exam = new Exam({ userId: 1, sessionId: 'session-123' });
      expect(exam.belongsTo(1, 'wrong-session')).toBe(true);
      expect(exam.belongsTo(999, 'session-123')).toBe(true);
      expect(exam.belongsTo(999, 'wrong-session')).toBe(false);
    });
  });

  describe('Status Management', () => {
    it('should convert database status to client format', () => {
      expect(new Exam({ status: 'pending' }).status).toBe('not_started');
      expect(new Exam({ status: 'active' }).status).toBe('in_progress');
      expect(new Exam({ status: 'completed' }).status).toBe('completed');
      expect(new Exam({ status: 'paused' }).status).toBe('paused');
    });

    it('should convert client status to database format', () => {
      expect(new Exam({ status: 'not_started' }).getDbStatus()).toBe('pending');
      expect(new Exam({ status: 'in_progress' }).getDbStatus()).toBe('active');
      expect(new Exam({ status: 'completed' }).getDbStatus()).toBe('completed');
    });
  });

  describe('Results Generation', () => {
    it('should generate comprehensive results', () => {
      const exam = new Exam({
        id: 'test-id',
        questions: [
          { id: 1, correctAnswers: [0], difficulty: 'easy', category: 'AWS' },
          { id: 2, correctAnswers: [1], difficulty: 'medium', category: 'AWS' },
          { id: 3, correctAnswers: [0, 1], difficulty: 'hard', category: 'Azure', isMultipleChoice: true, questionType: 'multiple_answer' },
        ],
        answers: { 1: 0, 2: 0, 3: [0, 1] },
        passingScore: 70,
      });

      exam.calculateScore();
      const results = exam.getResults();

      expect(results.examId).toBe('test-id');
      expect(results.questionResults).toHaveLength(3);
      expect(results.categoryStats).toBeDefined();
      expect(results.difficultyStats).toBeDefined();
    });
  });
});
