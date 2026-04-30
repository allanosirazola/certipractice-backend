/**
 * @fileoverview Question Model Unit Tests
 */

const Question = require('../../../src/models/Question');
const { questions } = require('../../fixtures');

describe('Question Model', () => {
  describe('Constructor', () => {
    it('should create question with default values', () => {
      const question = new Question({});

      expect(question.id).toBeNull();
      expect(question.text).toBe('');
      expect(question.options).toEqual([]);
      expect(question.correctAnswers).toEqual([]);
      expect(question.difficulty).toBe('medium');
      expect(question.points).toBe(1);
      expect(question.isActive).toBe(true);
    });

    it('should create question with provided data', () => {
      const data = {
        id: 1,
        question_text: 'What is AWS?',
        options: [
          { label: 'A', text: 'Cloud provider' },
          { label: 'B', text: 'Database' },
        ],
        correct_answer_indices: [0],
        difficulty_level: 'easy',
        points: 2,
        explanation: 'AWS is a cloud provider',
      };

      const question = new Question(data);

      expect(question.id).toBe(1);
      expect(question.text).toBe('What is AWS?');
      expect(question.options).toHaveLength(2);
      expect(question.correctAnswers).toEqual([0]);
      expect(question.difficulty).toBe('easy');
      expect(question.points).toBe(2);
    });

    it('should handle snake_case to camelCase conversion', () => {
      const data = {
        question_text: 'Test question',
        difficulty_level: 'hard',
        correct_answer_indices: [1, 2],
        expected_answers_count: 2,
        is_active: true,
        review_status: 'approved',
      };

      const question = new Question(data);

      expect(question.text).toBe('Test question');
      expect(question.difficulty).toBe('hard');
      expect(question.correctAnswers).toEqual([1, 2]);
      expect(question.expectedAnswers).toBe(2);
      expect(question.isActive).toBe(true);
      expect(question.reviewStatus).toBe('approved');
    });
  });

  describe('Static validate()', () => {
    const validQuestion = {
      text: 'What is 2 + 2?',
      options: [
        { label: 'A', text: '3' },
        { label: 'B', text: '4' },
        { label: 'C', text: '5' },
        { label: 'D', text: '6' },
      ],
      correctAnswers: [1],
      certificationId: 1,
    };

    it('should return empty array for valid question', () => {
      const errors = Question.validate(validQuestion);
      expect(errors).toEqual([]);
    });

    it('should validate required text', () => {
      const errors = Question.validate({
        ...validQuestion,
        text: '',
      });
      expect(errors).toContain('Question text is required');
    });

    it('should validate minimum options', () => {
      const errors = Question.validate({
        ...validQuestion,
        options: [{ label: 'A', text: 'Only one' }],
      });
      expect(errors.some((e) => e.toLowerCase().includes('at least 2'))).toBe(true);
    });

    it('should validate maximum options', () => {
      const errors = Question.validate({
        ...validQuestion,
        options: Array.from({ length: 12 }, (_, i) => ({
          label: String.fromCharCode(65 + i),
          text: `Option ${i + 1}`,
        })),
      });
      expect(errors.some((e) => e.toLowerCase().includes('maximum'))).toBe(true);
    });

    it('should validate correct answers present', () => {
      const errors = Question.validate({
        ...validQuestion,
        correctAnswers: [],
      });
      expect(errors.some((e) => e.includes('correct answer'))).toBe(true);
    });

    it('should validate correct answer indices are valid', () => {
      const errors = Question.validate({
        ...validQuestion,
        correctAnswers: [10],
      });
      expect(errors.some((e) => e.includes('Invalid correct answer'))).toBe(true);
    });

    it('should validate difficulty level', () => {
      const errors = Question.validate({
        ...validQuestion,
        difficulty: 'super_hard',
      });
      expect(errors.some((e) => e.includes('Difficulty'))).toBe(true);
    });

    it('should validate points range', () => {
      const errors1 = Question.validate({
        ...validQuestion,
        points: -1,
      });
      expect(errors1.some((e) => e.includes('Points'))).toBe(true);

      const errors2 = Question.validate({
        ...validQuestion,
        points: 100,
      });
      expect(errors2.some((e) => e.includes('Points'))).toBe(true);
    });

    it('should validate option labels are unique', () => {
      const errors = Question.validate({
        ...validQuestion,
        options: [
          { label: 'A', text: 'First' },
          { label: 'A', text: 'Duplicate label' },
          { label: 'B', text: 'Third' },
        ],
      });
      expect(errors.some((e) => e.toLowerCase().includes('unique'))).toBe(true);
    });
  });

  describe('isMultipleChoice getter', () => {
    it('should return true for multiple correct answers', () => {
      const question = new Question({
        correct_answer_indices: [0, 1],
        question_type: 'multiple_answer',
      });

      expect(question.isMultipleChoice).toBe(true);
    });

    it('should return true when expectedAnswers > 1', () => {
      const question = new Question({
        correct_answer_indices: [0, 2],
        expected_answers_count: 2,
      });

      expect(question.isMultipleChoice).toBe(true);
    });

    it('should return false for single choice', () => {
      const question = new Question({
        correct_answer_indices: [0],
        question_type: 'multiple_choice',
        expected_answers_count: 1,
      });

      expect(question.isMultipleChoice).toBe(false);
    });
  });

  describe('isCorrect()', () => {
    it('should evaluate single choice correctly', () => {
      const question = new Question({
        correct_answer_indices: [1],
      });

      expect(question.isCorrect(1)).toBe(true);
      expect(question.isCorrect(0)).toBe(false);
      expect(question.isCorrect(2)).toBe(false);
    });

    it('should evaluate multiple choice correctly', () => {
      const question = new Question({
        correct_answer_indices: [0, 2],
        question_type: 'multiple_answer',
      });

      expect(question.isCorrect([0, 2])).toBe(true);
      expect(question.isCorrect([2, 0])).toBe(true); // Order doesn't matter
      expect(question.isCorrect([0])).toBe(false); // Missing one
      expect(question.isCorrect([0, 1])).toBe(false); // Wrong one
      expect(question.isCorrect([0, 2, 3])).toBe(false); // Extra one
    });

    it('should handle array input for single choice', () => {
      const question = new Question({
        correct_answer_indices: [1],
      });

      expect(question.isCorrect([1])).toBe(true);
      expect(question.isCorrect([0])).toBe(false);
    });
  });

  describe('getCorrectOptionLabels()', () => {
    it('should return correct option labels', () => {
      const question = new Question({
        options: [
          { label: 'A', text: 'Option A' },
          { label: 'B', text: 'Option B' },
          { label: 'C', text: 'Option C' },
          { label: 'D', text: 'Option D' },
        ],
        correct_answer_indices: [1, 2],
      });

      expect(question.getCorrectOptionLabels()).toEqual(['B', 'C']);
    });
  });

  describe('shuffle()', () => {
    it('should shuffle options', () => {
      const question = new Question({
        options: [
          { label: 'A', text: 'Option A' },
          { label: 'B', text: 'Option B' },
          { label: 'C', text: 'Option C' },
          { label: 'D', text: 'Option D' },
        ],
        correct_answer_indices: [0],
      });

      const originalOptions = [...question.options];
      question.shuffle();

      // Options should still have same length
      expect(question.options).toHaveLength(4);

      // Correct answer should still be tracked
      const correctText = originalOptions[0].text;
      const newCorrectIndex = question.options.findIndex(
        (opt) => opt.text === correctText
      );
      expect(question.correctAnswers).toContain(newCorrectIndex);
    });
  });

  describe('toExamFormat()', () => {
    it('should return question without correct answers', () => {
      const question = new Question({
        id: 1,
        question_text: 'Test question?',
        options: [
          { label: 'A', text: 'Option A' },
          { label: 'B', text: 'Option B' },
        ],
        correct_answer_indices: [0],
        explanation: 'This is the explanation',
      });

      const examFormat = question.toExamFormat();

      expect(examFormat.id).toBe(1);
      expect(examFormat.text).toBe('Test question?');
      expect(examFormat.options).toHaveLength(2);
      expect(examFormat.correctAnswers).toBeUndefined();
      expect(examFormat.explanation).toBeUndefined();
    });

    it('should include metadata when requested', () => {
      const question = new Question({
        id: 1,
        question_text: 'Test question?',
        options: [{ label: 'A', text: 'Option A' }],
        difficulty_level: 'hard',
        category: 'AWS',
      });

      const examFormat = question.toExamFormat({ includeMetadata: true });

      expect(examFormat.difficulty).toBe('hard');
      expect(examFormat.category).toBe('AWS');
    });
  });

  describe('toReviewFormat()', () => {
    it('should return question with correct answers and explanation', () => {
      const question = new Question({
        id: 1,
        question_text: 'Test question?',
        options: [
          { label: 'A', text: 'Option A' },
          { label: 'B', text: 'Option B' },
        ],
        correct_answer_indices: [0],
        explanation: 'This is the explanation',
      });

      const reviewFormat = question.toReviewFormat();

      expect(reviewFormat.correctAnswers).toEqual([0]);
      expect(reviewFormat.explanation).toBe('This is the explanation');
      expect(reviewFormat.correctLabels).toEqual(['A']);
    });
  });

  describe('toJSON()', () => {
    it('should return serializable object', () => {
      const question = new Question({
        id: 1,
        question_text: 'Test question?',
        options: [{ label: 'A', text: 'Option A' }],
        correct_answer_indices: [0],
        difficulty_level: 'medium',
        points: 1,
        explanation: 'Explanation',
        category: 'Test',
        certification_name: 'Test Cert',
      });

      const json = question.toJSON();

      expect(json.id).toBe(1);
      expect(json.text).toBe('Test question?');
      expect(json.options).toHaveLength(1);
      expect(json.isMultipleChoice).toBe(false);
    });
  });

  describe('Difficulty constants', () => {
    it('should have correct difficulty values', () => {
      expect(Question.Difficulty.EASY).toBe('easy');
      expect(Question.Difficulty.MEDIUM).toBe('medium');
      expect(Question.Difficulty.HARD).toBe('hard');
      expect(Question.Difficulty.EXPERT).toBe('expert');
    });
  });

  describe('Review status constants', () => {
    it('should have correct review status values', () => {
      expect(Question.ReviewStatus.PENDING).toBe('pending');
      expect(Question.ReviewStatus.APPROVED).toBe('approved');
      expect(Question.ReviewStatus.REJECTED).toBe('rejected');
      expect(Question.ReviewStatus.NEEDS_REVISION).toBe('needs_revision');
    });
  });

  describe('isValidDifficulty()', () => {
    it('should validate known difficulty levels', () => {
      expect(Question.isValidDifficulty('easy')).toBe(true);
      expect(Question.isValidDifficulty('medium')).toBe(true);
      expect(Question.isValidDifficulty('hard')).toBe(true);
      expect(Question.isValidDifficulty('expert')).toBe(true);
    });

    it('should reject unknown difficulty levels', () => {
      expect(Question.isValidDifficulty('super_hard')).toBe(false);
      expect(Question.isValidDifficulty('')).toBe(false);
      expect(Question.isValidDifficulty(null)).toBe(false);
    });
  });

  describe('clone()', () => {
    it('should create a deep copy', () => {
      const original = new Question({
        id: 1,
        question_text: 'Original?',
        options: [{ label: 'A', text: 'Option' }],
        correct_answer_indices: [0],
      });

      const clone = original.clone();

      expect(clone.id).toBe(original.id);
      expect(clone.text).toBe(original.text);
      expect(clone).not.toBe(original);
      expect(clone.options).not.toBe(original.options);

      // Modifying clone should not affect original
      clone.options.push({ label: 'B', text: 'New option' });
      expect(original.options).toHaveLength(1);
    });
  });
});
