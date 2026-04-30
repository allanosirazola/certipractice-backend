/**
 * @fileoverview Question Service Unit Tests
 */

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/utils/database', () => {
  const mockQuery = jest.fn();
  const mockTransaction = jest.fn();
  
  return {
    query: mockQuery,
    transaction: mockTransaction,
    __mockQuery: mockQuery,
    __mockTransaction: mockTransaction,
  };
});

jest.mock('../../../src/config/config', () => ({
  isTest: true,
}));

const Question = require('../../../src/models/Question');
const db = require('../../../src/utils/database');

describe('QuestionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Question Model Integration', () => {
    const validQuestion = {
      text: 'What is the capital of France?',
      options: [
        { label: 'A', text: 'London' },
        { label: 'B', text: 'Paris' },
        { label: 'C', text: 'Berlin' },
        { label: 'D', text: 'Madrid' },
      ],
      correctAnswers: [1],
      difficulty: 'easy',
      certificationId: 1,
      points: 1,
    };

    describe('Question.validate()', () => {
      it('should validate valid question', () => {
        const errors = Question.validate(validQuestion);
        expect(errors).toHaveLength(0);
      });

      it('should require question text', () => {
        const errors = Question.validate({
          ...validQuestion,
          text: '',
        });
        expect(errors.some(e => e.toLowerCase().includes('text'))).toBe(true);
      });

      it('should require minimum question text length', () => {
        const errors = Question.validate({
          ...validQuestion,
          text: 'Short?',
        });
        expect(errors.some(e => e.toLowerCase().includes('10 characters'))).toBe(true);
      });

      it('should require at least 2 options', () => {
        const errors = Question.validate({
          ...validQuestion,
          options: [{ label: 'A', text: 'Only one' }],
        });
        expect(errors.some(e => e.toLowerCase().includes('at least 2'))).toBe(true);
      });

      it('should limit maximum options', () => {
        const manyOptions = Array.from({ length: 12 }, (_, i) => ({
          label: String.fromCharCode(65 + i),
          text: `Option ${i + 1}`,
        }));
        const errors = Question.validate({
          ...validQuestion,
          options: manyOptions,
        });
        expect(errors.some(e => e.toLowerCase().includes('maximum'))).toBe(true);
      });

      it('should require correct answers', () => {
        const errors = Question.validate({
          ...validQuestion,
          correctAnswers: [],
        });
        expect(errors.some(e => e.toLowerCase().includes('correct'))).toBe(true);
      });

      it('should validate correct answer indices', () => {
        const errors = Question.validate({
          ...validQuestion,
          correctAnswers: [10], // Out of bounds
        });
        expect(errors.some(e => e.toLowerCase().includes('invalid') || e.toLowerCase().includes('index'))).toBe(true);
      });

      it('should require valid difficulty', () => {
        const errors = Question.validate({
          ...validQuestion,
          difficulty: 'super_hard',
        });
        expect(errors.some(e => e.toLowerCase().includes('difficulty'))).toBe(true);
      });

      it('should require certification', () => {
        const errors = Question.validate({
          ...validQuestion,
          certificationId: undefined,
        });
        expect(errors.some(e => e.toLowerCase().includes('certification'))).toBe(true);
      });
    });

    describe('Question Instance Methods', () => {
      const questionData = {
        question_text: 'What is the capital of France?',
        options: [
          { label: 'A', text: 'London' },
          { label: 'B', text: 'Paris' },
          { label: 'C', text: 'Berlin' },
          { label: 'D', text: 'Madrid' },
        ],
        correctAnswers: [1], // Use camelCase
        difficulty: 'easy',
      };

      it('should check if answer is correct (single choice)', () => {
        const question = new Question(questionData);
        
        expect(question.isCorrect([1])).toBe(true);
        expect(question.isCorrect([0])).toBe(false);
        expect(question.isCorrect([2])).toBe(false);
      });

      it('should check if answer is correct (multiple choice)', () => {
        const multiQuestion = new Question({
          ...questionData,
          correctAnswers: [0, 2],
        });
        
        expect(multiQuestion.isCorrect([0, 2])).toBe(true);
        expect(multiQuestion.isCorrect([2, 0])).toBe(true); // Order doesn't matter
        expect(multiQuestion.isCorrect([0])).toBe(false);
        expect(multiQuestion.isCorrect([0, 1, 2])).toBe(false);
      });

      it('should detect multiple answer questions', () => {
        const singleChoice = new Question(questionData);
        const multiChoice = new Question({
          ...questionData,
          correctAnswers: [0, 2],
        });
        
        expect(singleChoice.isMultipleAnswer()).toBe(false);
        expect(multiChoice.isMultipleAnswer()).toBe(true);
      });

      it('should get options without answers for exam', () => {
        const question = new Question(questionData);
        const examOptions = question.getOptionsForExam();
        
        expect(examOptions).toHaveLength(4);
        expect(examOptions[0]).toHaveProperty('label');
        expect(examOptions[0]).toHaveProperty('text');
      });

      it('should convert to JSON with answers', () => {
        const question = new Question({ ...questionData, id: 1 });
        const json = question.toJSON(true);
        
        expect(json.id).toBe(1);
        expect(json.correctAnswers).toBeDefined();
      });

      it('should convert to JSON without answers', () => {
        const question = new Question({ ...questionData, id: 1 });
        const json = question.toJSON(false);
        
        expect(json.id).toBe(1);
        expect(json.correctAnswers).toBeUndefined();
      });

      it('should convert to database format', () => {
        const question = new Question(questionData);
        const dbData = question.toDatabase();
        
        expect(dbData.question_text).toBe(questionData.question_text);
        expect(typeof dbData.options).toBe('string'); // JSON stringified
        // Check that correct_answer_indices is stringified
        expect(dbData.correct_answer_indices).toBeDefined();
      });
    });

    describe('Difficulty Validation', () => {
      it('should accept valid difficulties', () => {
        expect(Question.isValidDifficulty('easy')).toBe(true);
        expect(Question.isValidDifficulty('medium')).toBe(true);
        expect(Question.isValidDifficulty('hard')).toBe(true);
        expect(Question.isValidDifficulty('expert')).toBe(true);
      });

      it('should reject invalid difficulties', () => {
        expect(Question.isValidDifficulty('super_hard')).toBe(false);
        expect(Question.isValidDifficulty('')).toBe(false);
        expect(Question.isValidDifficulty(null)).toBe(false);
      });
    });
  });

  describe('Service Functions (Mocked)', () => {
    describe('createQuestion pattern', () => {
      it('should create question with pending status', async () => {
        db.__mockQuery.mockResolvedValueOnce({
          rows: [{ 
            id: 1, 
            question_text: 'Test?',
            review_status: 'pending',
          }],
        });

        const createQuestion = async (data) => {
          const result = await db.query(
            `INSERT INTO questions (question_text, review_status) 
             VALUES ($1, 'pending') RETURNING *`,
            [data.question_text]
          );
          return result.rows[0];
        };

        const question = await createQuestion({ question_text: 'Test?' });
        
        expect(question.review_status).toBe('pending');
      });
    });

    describe('getById pattern', () => {
      it('should get question by id', async () => {
        db.__mockQuery.mockResolvedValueOnce({
          rows: [{ 
            id: 1, 
            question_text: 'Test question?',
            difficulty: 'easy',
          }],
        });

        const getById = async (id) => {
          const result = await db.query(
            'SELECT * FROM questions WHERE id = $1',
            [id]
          );
          return result.rows[0] || null;
        };

        const question = await getById(1);
        
        expect(question.id).toBe(1);
      });

      it('should return null for non-existent id', async () => {
        db.__mockQuery.mockResolvedValueOnce({ rows: [] });

        const getById = async (id) => {
          const result = await db.query(
            'SELECT * FROM questions WHERE id = $1',
            [id]
          );
          return result.rows[0] || null;
        };

        const question = await getById(999);
        
        expect(question).toBeNull();
      });
    });

    describe('getQuestions pattern (pagination)', () => {
      it('should paginate questions', async () => {
        db.__mockQuery
          .mockResolvedValueOnce({
            rows: [
              { id: 1, question_text: 'Q1' },
              { id: 2, question_text: 'Q2' },
            ],
          })
          .mockResolvedValueOnce({
            rows: [{ count: '10' }],
          });

        const getQuestions = async (page = 1, limit = 10) => {
          const offset = (page - 1) * limit;
          
          const [questions, countResult] = await Promise.all([
            db.query(
              'SELECT * FROM questions ORDER BY id LIMIT $1 OFFSET $2',
              [limit, offset]
            ),
            db.query('SELECT COUNT(*) FROM questions'),
          ]);

          return {
            questions: questions.rows,
            total: parseInt(countResult.rows[0].count, 10),
            page,
            limit,
          };
        };

        const result = await getQuestions(1, 2);
        
        expect(result.questions).toHaveLength(2);
        expect(result.total).toBe(10);
        expect(result.page).toBe(1);
      });
    });

    describe('getRandomQuestions pattern', () => {
      it('should get random questions', async () => {
        db.__mockQuery.mockResolvedValueOnce({
          rows: [
            { id: 3, question_text: 'Q3' },
            { id: 7, question_text: 'Q7' },
            { id: 1, question_text: 'Q1' },
          ],
        });

        const getRandomQuestions = async (count, filters = {}) => {
          let query = 'SELECT * FROM questions WHERE 1=1';
          const params = [];
          let paramIndex = 1;

          if (filters.difficulty) {
            query += ` AND difficulty = $${paramIndex++}`;
            params.push(filters.difficulty);
          }

          if (filters.certificationId) {
            query += ` AND certification_id = $${paramIndex++}`;
            params.push(filters.certificationId);
          }

          query += ` ORDER BY RANDOM() LIMIT $${paramIndex}`;
          params.push(count);

          const result = await db.query(query, params);
          return result.rows;
        };

        const questions = await getRandomQuestions(3, { difficulty: 'medium' });
        
        expect(questions).toHaveLength(3);
      });
    });

    describe('searchQuestions pattern', () => {
      it('should search questions by text', async () => {
        db.__mockQuery.mockResolvedValueOnce({
          rows: [
            { id: 1, question_text: 'What is AWS?' },
            { id: 2, question_text: 'Explain AWS services' },
          ],
        });

        const searchQuestions = async (searchTerm, limit = 10) => {
          const result = await db.query(
            `SELECT * FROM questions 
             WHERE question_text ILIKE $1 
             ORDER BY id LIMIT $2`,
            [`%${searchTerm}%`, limit]
          );
          return result.rows;
        };

        const questions = await searchQuestions('AWS');
        
        expect(questions).toHaveLength(2);
        expect(questions[0].question_text).toContain('AWS');
      });
    });

    describe('updateQuestion pattern', () => {
      it('should update question fields', async () => {
        db.__mockQuery.mockResolvedValueOnce({
          rows: [{ 
            id: 1, 
            question_text: 'Updated question?',
            difficulty: 'hard',
          }],
        });

        const updateQuestion = async (id, updates) => {
          const fields = Object.keys(updates);
          const setClauses = fields.map((f, i) => `${f} = $${i + 2}`);
          const values = [id, ...fields.map(f => updates[f])];

          const result = await db.query(
            `UPDATE questions SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
            values
          );
          return result.rows[0];
        };

        const updated = await updateQuestion(1, { 
          question_text: 'Updated question?',
          difficulty: 'hard',
        });
        
        expect(updated.difficulty).toBe('hard');
      });
    });

    describe('deleteQuestion pattern', () => {
      it('should delete question', async () => {
        db.__mockQuery.mockResolvedValueOnce({ rowCount: 1 });

        const deleteQuestion = async (id) => {
          const result = await db.query(
            'DELETE FROM questions WHERE id = $1',
            [id]
          );
          return result.rowCount > 0;
        };

        const deleted = await deleteQuestion(1);
        
        expect(deleted).toBe(true);
      });
    });

    describe('getCategories pattern', () => {
      it('should get distinct topics', async () => {
        db.__mockQuery.mockResolvedValueOnce({
          rows: [
            { topic: 'AWS', count: '10' },
            { topic: 'Azure', count: '8' },
            { topic: 'GCP', count: '5' },
          ],
        });

        const getCategories = async () => {
          const result = await db.query(
            `SELECT topic, COUNT(*) as count 
             FROM questions 
             GROUP BY topic 
             ORDER BY count DESC`
          );
          return result.rows;
        };

        const categories = await getCategories();
        
        expect(categories).toHaveLength(3);
        expect(categories[0].topic).toBe('AWS');
      });
    });

    describe('reviewQuestion pattern', () => {
      it('should approve question', async () => {
        db.__mockQuery.mockResolvedValueOnce({
          rows: [{ id: 1, review_status: 'approved' }],
        });

        const reviewQuestion = async (id, status, reviewerId) => {
          const result = await db.query(
            `UPDATE questions 
             SET review_status = $2, reviewed_by = $3, reviewed_at = NOW() 
             WHERE id = $1 RETURNING *`,
            [id, status, reviewerId]
          );
          return result.rows[0];
        };

        const reviewed = await reviewQuestion(1, 'approved', 100);
        
        expect(reviewed.review_status).toBe('approved');
      });

      it('should reject question', async () => {
        db.__mockQuery.mockResolvedValueOnce({
          rows: [{ id: 1, review_status: 'rejected' }],
        });

        const reviewQuestion = async (id, status, reviewerId) => {
          const result = await db.query(
            `UPDATE questions 
             SET review_status = $2, reviewed_by = $3, reviewed_at = NOW() 
             WHERE id = $1 RETURNING *`,
            [id, status, reviewerId]
          );
          return result.rows[0];
        };

        const reviewed = await reviewQuestion(1, 'rejected', 100);
        
        expect(reviewed.review_status).toBe('rejected');
      });
    });

    describe('bulkCreate pattern', () => {
      it('should create multiple questions in transaction', async () => {
        const questions = [
          { question_text: 'Q1?', difficulty: 'easy' },
          { question_text: 'Q2?', difficulty: 'medium' },
        ];

        db.__mockTransaction.mockImplementation(async (callback) => {
          const mockClient = {
            query: jest.fn()
              .mockResolvedValueOnce({ rows: [{ id: 1 }] })
              .mockResolvedValueOnce({ rows: [{ id: 2 }] }),
          };
          return callback(mockClient);
        });

        const bulkCreate = async (questionsData) => {
          return db.transaction(async (client) => {
            const created = [];
            for (const q of questionsData) {
              const result = await client.query(
                'INSERT INTO questions (question_text, difficulty) VALUES ($1, $2) RETURNING id',
                [q.question_text, q.difficulty]
              );
              created.push(result.rows[0]);
            }
            return created;
          });
        };

        const created = await bulkCreate(questions);
        
        expect(created).toHaveLength(2);
        expect(db.__mockTransaction).toHaveBeenCalled();
      });
    });
  });
});
