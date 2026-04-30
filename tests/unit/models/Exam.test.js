/**
 * @fileoverview Exam Model Unit Tests
 */

const Exam = require('../../../src/models/Exam');
const { exams, questions, certifications } = require('../../fixtures');

describe('Exam Model', () => {
  describe('Constructor', () => {
    it('should create an exam with default values', () => {
      const exam = new Exam({});

      expect(exam.id).toBeNull();
      expect(exam.userId).toBeNull();
      expect(exam.sessionId).toBeNull();
      expect(exam.status).toBe(Exam.Status.NOT_STARTED);
      expect(exam.score).toBe(0);
      expect(exam.passed).toBe(false);
      expect(exam.questions).toEqual([]);
      expect(exam.answers).toEqual({});
    });

    it('should create an exam with provided data', () => {
      const data = {
        id: 'test-uuid',
        userId: 1,
        title: 'Test Exam',
        provider: 'AWS',
        certification: 'SAA-C03',
        questions: [{ id: 1 }, { id: 2 }],
        timeLimit: 60,
        passingScore: 70,
        mode: 'practice',
      };

      const exam = new Exam(data);

      expect(exam.id).toBe('test-uuid');
      expect(exam.userId).toBe(1);
      expect(exam.title).toBe('Test Exam');
      expect(exam.provider).toBe('AWS');
      expect(exam.questions).toHaveLength(2);
      expect(exam.timeLimit).toBe(60);
      expect(exam.passingScore).toBe(70);
      expect(exam.mode).toBe('practice');
    });

    it('should normalize database status to client format', () => {
      const exam1 = new Exam({ status: 'pending' });
      expect(exam1.status).toBe(Exam.Status.NOT_STARTED);

      const exam2 = new Exam({ status: 'active' });
      expect(exam2.status).toBe(Exam.Status.IN_PROGRESS);

      const exam3 = new Exam({ status: 'completed' });
      expect(exam3.status).toBe(Exam.Status.COMPLETED);
    });

    it('should use snake_case database fields', () => {
      const data = {
        user_id: 1,
        session_id: 'session-123',
        time_limit_minutes: 90,
        time_spent_minutes: 30,
        passing_score: 75,
        certification_id: 5,
      };

      const exam = new Exam(data);

      expect(exam.userId).toBe(1);
      expect(exam.sessionId).toBe('session-123');
      expect(exam.timeLimit).toBe(90);
      expect(exam.timeSpent).toBe(30);
      expect(exam.passingScore).toBe(75);
      expect(exam.certificationId).toBe(5);
    });
  });

  describe('Static validate()', () => {
    it('should return empty array for valid exam config', () => {
      const validConfig = {
        provider: 1,
        certification: 1,
        mode: 'practice',
        questionCount: 20,
        timeLimit: 60,
      };

      const errors = Exam.validate(validConfig);
      expect(errors).toEqual([]);
    });

    it('should validate required provider', () => {
      const errors = Exam.validate({ certification: 1 });
      expect(errors).toContain('Provider is required');
    });

    it('should validate required certification', () => {
      const errors = Exam.validate({ provider: 1 });
      expect(errors).toContain('Certification is required');
    });

    it('should validate mode', () => {
      const errors = Exam.validate({
        provider: 1,
        certification: 1,
        mode: 'invalid_mode',
      });
      expect(errors.some(e => e.includes('Mode must be one of'))).toBe(true);
    });

    it('should validate minimum question count', () => {
      const errors = Exam.validate({
        provider: 1,
        certification: 1,
        questionCount: 2,
      });
      expect(errors.some(e => e.includes('at least'))).toBe(true);
    });

    it('should validate maximum question count', () => {
      const errors = Exam.validate({
        provider: 1,
        certification: 1,
        questionCount: 500,
      });
      expect(errors.some(e => e.includes('cannot exceed'))).toBe(true);
    });

    it('should validate time limit range', () => {
      const errors1 = Exam.validate({
        provider: 1,
        certification: 1,
        timeLimit: 0,
      });
      expect(errors1.some(e => e.includes('at least 1 minute'))).toBe(true);

      const errors2 = Exam.validate({
        provider: 1,
        certification: 1,
        timeLimit: 1000,
      });
      expect(errors2.some(e => e.includes('cannot exceed'))).toBe(true);
    });

    it('should validate passing score range', () => {
      const errors1 = Exam.validate({
        provider: 1,
        certification: 1,
        passingScore: -10,
      });
      expect(errors1.some(e => e.includes('between 0 and 100'))).toBe(true);

      const errors2 = Exam.validate({
        provider: 1,
        certification: 1,
        passingScore: 150,
      });
      expect(errors2.some(e => e.includes('between 0 and 100'))).toBe(true);
    });

    it('should validate difficulty level', () => {
      const errors = Exam.validate({
        provider: 1,
        certification: 1,
        difficulty: 'super_hard',
      });
      expect(errors.some(e => e.includes('Difficulty must be one of'))).toBe(true);
    });

    it('should accept valid difficulty levels', () => {
      ['easy', 'medium', 'hard', 'expert'].forEach(difficulty => {
        const errors = Exam.validate({
          provider: 1,
          certification: 1,
          difficulty,
        });
        expect(errors).toEqual([]);
      });
    });
  });

  describe('belongsTo()', () => {
    it('should return true for matching userId', () => {
      const exam = new Exam({ userId: 1 });
      expect(exam.belongsTo(1, null)).toBe(true);
    });

    it('should return true for matching sessionId', () => {
      const exam = new Exam({ sessionId: 'session-123' });
      expect(exam.belongsTo(null, 'session-123')).toBe(true);
    });

    it('should return false for non-matching userId', () => {
      const exam = new Exam({ userId: 1 });
      expect(exam.belongsTo(2, null)).toBe(false);
    });

    it('should return false for non-matching sessionId', () => {
      const exam = new Exam({ sessionId: 'session-123' });
      expect(exam.belongsTo(null, 'session-456')).toBe(false);
    });

    it('should return false when neither matches', () => {
      const exam = new Exam({ userId: 1, sessionId: 'session-123' });
      expect(exam.belongsTo(2, 'session-456')).toBe(false);
    });

    it('should return true when either matches', () => {
      const exam = new Exam({ userId: 1, sessionId: 'session-123' });
      expect(exam.belongsTo(1, 'wrong-session')).toBe(true);
      expect(exam.belongsTo(999, 'session-123')).toBe(true);
    });
  });

  describe('isAnswerCorrect()', () => {
    it('should correctly evaluate single choice questions', () => {
      const exam = new Exam({});
      const question = {
        isMultipleChoice: false,
        correctAnswers: [1],
      };

      expect(exam.isAnswerCorrect(question, 1)).toBe(true);
      expect(exam.isAnswerCorrect(question, 0)).toBe(false);
      expect(exam.isAnswerCorrect(question, 2)).toBe(false);
    });

    it('should handle array input for single choice', () => {
      const exam = new Exam({});
      const question = {
        isMultipleChoice: false,
        correctAnswers: [1],
      };

      expect(exam.isAnswerCorrect(question, [1])).toBe(true);
      expect(exam.isAnswerCorrect(question, [0])).toBe(false);
    });

    it('should correctly evaluate multiple choice questions', () => {
      const exam = new Exam({});
      const question = {
        isMultipleChoice: true,
        questionType: 'multiple_answer',
        correctAnswers: [0, 2],
      };

      expect(exam.isAnswerCorrect(question, [0, 2])).toBe(true);
      expect(exam.isAnswerCorrect(question, [2, 0])).toBe(true); // Order shouldn't matter
      expect(exam.isAnswerCorrect(question, [0])).toBe(false); // Missing one
      expect(exam.isAnswerCorrect(question, [0, 1])).toBe(false); // Wrong one
      expect(exam.isAnswerCorrect(question, [0, 2, 3])).toBe(false); // Extra one
    });

    it('should return false for empty correctAnswers', () => {
      const exam = new Exam({});
      const question = { correctAnswers: [] };

      expect(exam.isAnswerCorrect(question, 0)).toBe(false);
    });

    it('should return false for null correctAnswers', () => {
      const exam = new Exam({});
      const question = { correctAnswers: null };

      expect(exam.isAnswerCorrect(question, 0)).toBe(false);
    });
  });

  describe('validateAnswer()', () => {
    const createExamWithQuestion = (questionOverrides = {}) => {
      return new Exam({
        questions: [
          {
            id: 1,
            isMultipleChoice: false,
            expectedAnswers: 1,
            options: [
              { label: 'A' },
              { label: 'B' },
              { label: 'C' },
              { label: 'D' },
            ],
            ...questionOverrides,
          },
        ],
      });
    };

    it('should validate valid single answer', () => {
      const exam = createExamWithQuestion();
      expect(exam.validateAnswer(1, 0)).toBe(0);
      expect(exam.validateAnswer(1, 3)).toBe(3);
    });

    it('should throw for non-existent question', () => {
      const exam = createExamWithQuestion();
      expect(() => exam.validateAnswer(999, 0)).toThrow('Question not found');
    });

    it('should throw for invalid index', () => {
      const exam = createExamWithQuestion();
      expect(() => exam.validateAnswer(1, -1)).toThrow('Invalid answer index');
      expect(() => exam.validateAnswer(1, 10)).toThrow('Invalid answer index');
    });

    it('should validate multiple choice answer', () => {
      const exam = createExamWithQuestion({
        isMultipleChoice: true,
        questionType: 'multiple_answer',
        expectedAnswers: 2,
      });

      expect(exam.validateAnswer(1, [0, 1])).toEqual([0, 1]);
    });

    it('should require array for multiple choice', () => {
      const exam = createExamWithQuestion({
        isMultipleChoice: true,
        questionType: 'multiple_answer',
      });

      expect(() => exam.validateAnswer(1, 0)).toThrow('require array');
    });

    it('should throw for empty array in multiple choice', () => {
      const exam = createExamWithQuestion({
        isMultipleChoice: true,
      });

      expect(() => exam.validateAnswer(1, [])).toThrow('At least one answer');
    });

    it('should throw for too many answers', () => {
      const exam = createExamWithQuestion({
        isMultipleChoice: true,
        expectedAnswers: 2,
      });

      expect(() => exam.validateAnswer(1, [0, 1, 2])).toThrow('Too many answers');
    });

    it('should remove duplicate answers', () => {
      const exam = createExamWithQuestion({
        isMultipleChoice: true,
        expectedAnswers: 3,
      });

      expect(exam.validateAnswer(1, [0, 0, 1])).toEqual([0, 1]);
    });
  });

  describe('calculateScore()', () => {
    it('should calculate correct score', () => {
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
      expect(exam.correctAnswers).toBe(3);
      expect(exam.incorrectAnswers).toBe(1);
      expect(exam.passed).toBe(true);
    });

    it('should handle empty exam', () => {
      const exam = new Exam({ questions: [], answers: {} });
      expect(exam.calculateScore()).toBe(0);
    });

    it('should consider points for weighted scoring', () => {
      const exam = new Exam({
        questions: [
          { id: 1, correctAnswers: [0], points: 2 },
          { id: 2, correctAnswers: [1], points: 1 },
          { id: 3, correctAnswers: [2], points: 1 },
        ],
        answers: {
          1: 0, // Correct (2 points)
          2: 0, // Wrong (0 points)
          3: 0, // Wrong (0 points)
        },
      });

      const score = exam.calculateScore();
      expect(score).toBe(50); // 2 out of 4 points
    });
  });

  describe('getTimeRemaining()', () => {
    it('should return 0 when not in progress', () => {
      const exam = new Exam({ status: 'not_started', timeLimit: 60 });
      expect(exam.getTimeRemaining()).toBe(0);
    });

    it('should return 0 when no start time', () => {
      const exam = new Exam({ status: 'in_progress', timeLimit: 60, startedAt: null });
      expect(exam.getTimeRemaining()).toBe(0);
    });

    it('should calculate remaining time correctly', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const exam = new Exam({
        status: 'in_progress',
        timeLimit: 10,
        startedAt: fiveMinutesAgo.toISOString(),
      });

      const remaining = exam.getTimeRemaining();
      // Should be approximately 5 minutes (300 seconds) remaining
      expect(remaining).toBeWithinRange(295, 305);
    });

    it('should return 0 when time expired', () => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const exam = new Exam({
        status: 'in_progress',
        timeLimit: 10,
        startedAt: thirtyMinutesAgo.toISOString(),
      });

      expect(exam.getTimeRemaining()).toBe(0);
    });
  });

  describe('isTimeExpired()', () => {
    it('should return true when time is up', () => {
      const exam = new Exam({
        status: 'in_progress',
        timeLimit: 10,
        startedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      });

      expect(exam.isTimeExpired()).toBe(true);
    });

    it('should return false when time remains', () => {
      const exam = new Exam({
        status: 'in_progress',
        timeLimit: 60,
        startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      });

      expect(exam.isTimeExpired()).toBe(false);
    });

    it('should return false for non-in-progress exams', () => {
      const exam = new Exam({
        status: 'completed',
        timeLimit: 10,
        startedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      });

      expect(exam.isTimeExpired()).toBe(false);
    });
  });

  describe('getProgress()', () => {
    it('should calculate progress correctly', () => {
      const exam = new Exam({
        questions: [
          { id: 1, correctAnswers: [0] },
          { id: 2, correctAnswers: [1] },
          { id: 3, correctAnswers: [2] },
          { id: 4, correctAnswers: [0] },
        ],
        answers: {
          1: 0, // Correct
          2: 0, // Wrong
        },
      });

      const progress = exam.getProgress();

      expect(progress.totalQuestions).toBe(4);
      expect(progress.answeredQuestions).toBe(2);
      expect(progress.remainingQuestions).toBe(2);
      expect(progress.progressPercentage).toBe(50);
      expect(progress.correctAnswers).toBe(1);
      expect(progress.incorrectAnswers).toBe(1);
      expect(progress.accuracyPercentage).toBe(50);
    });

    it('should handle empty exam', () => {
      const exam = new Exam({ questions: [], answers: {} });
      const progress = exam.getProgress();

      expect(progress.totalQuestions).toBe(0);
      expect(progress.progressPercentage).toBe(0);
      expect(progress.accuracyPercentage).toBe(0);
    });
  });

  describe('getResults()', () => {
    it('should return comprehensive results', () => {
      const exam = new Exam({
        id: 'test-exam-id',
        questions: [
          { id: 1, correctAnswers: [0], difficulty: 'easy', category: 'AWS', isMultipleChoice: false },
          { id: 2, correctAnswers: [1], difficulty: 'medium', category: 'AWS', isMultipleChoice: false },
          { id: 3, correctAnswers: [0, 1], difficulty: 'hard', category: 'Azure', isMultipleChoice: true, questionType: 'multiple_answer' },
        ],
        answers: {
          1: 0,      // Correct
          2: 0,      // Wrong
          3: [0, 1], // Correct
        },
        timeSpent: 15,
        timeLimit: 30,
        passingScore: 70,
      });

      exam.calculateScore();
      const results = exam.getResults();

      expect(results.examId).toBe('test-exam-id');
      expect(results.totalQuestions).toBe(3);
      expect(results.correctAnswers).toBe(2);
      expect(results.incorrectAnswers).toBe(1);
      expect(results.unansweredQuestions).toBe(0);
      expect(results.questionResults).toHaveLength(3);

      // Category stats
      expect(results.categoryStats.AWS.total).toBe(2);
      expect(results.categoryStats.Azure.total).toBe(1);

      // Difficulty stats
      expect(results.difficultyStats.easy.total).toBe(1);
      expect(results.difficultyStats.medium.total).toBe(1);
      expect(results.difficultyStats.hard.total).toBe(1);
    });
  });

  describe('toJSON()', () => {
    it('should return serializable object', () => {
      const exam = new Exam({
        id: 'test-id',
        userId: 1,
        title: 'Test Exam',
        questions: [{ id: 1 }],
      });

      const json = exam.toJSON();

      expect(json.id).toBe('test-id');
      expect(json.userId).toBe(1);
      expect(json.title).toBe('Test Exam');
      expect(json.questions).toHaveLength(1);
      expect(json.summary).toBeDefined();
    });
  });

  describe('getDbStatus()', () => {
    it('should convert client status to database format', () => {
      const exam1 = new Exam({ status: 'not_started' });
      expect(exam1.getDbStatus()).toBe('pending');

      const exam2 = new Exam({ status: 'in_progress' });
      expect(exam2.getDbStatus()).toBe('active');

      const exam3 = new Exam({ status: 'completed' });
      expect(exam3.getDbStatus()).toBe('completed');
    });
  });

  describe('Status and Mode enums', () => {
    it('should have correct Status values', () => {
      expect(Exam.Status.NOT_STARTED).toBe('not_started');
      expect(Exam.Status.IN_PROGRESS).toBe('in_progress');
      expect(Exam.Status.PAUSED).toBe('paused');
      expect(Exam.Status.COMPLETED).toBe('completed');
      expect(Exam.Status.CANCELLED).toBe('cancelled');
    });

    it('should have correct Mode values', () => {
      expect(Exam.Mode.PRACTICE).toBe('practice');
      expect(Exam.Mode.EXAM).toBe('exam');
      expect(Exam.Mode.FAILED_QUESTIONS).toBe('failed_questions');
    });
  });
});
