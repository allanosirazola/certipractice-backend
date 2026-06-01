// src/services/examService.js - Rewritten for the current PostgreSQL schema.
//
// Schema notes (see prisma/schema.prisma):
//   exams        : id(uuid), user_id(int?), session_id(varchar?), certification_id(int),
//                  title, description?, mode(ExamMode: practice|timed|review|simulation),
//                  question_count, time_limit(min), passing_score(numeric), status
//                  (ExamStatus: pending|active|paused|completed|abandoned), score,
//                  passed, current_index, settings(jsonb), started_at, completed_at,
//                  paused_at, total_paused_time, created_at, updated_at
//   exam_answers : id(uuid), exam_id(uuid), question_id(uuid), order_index,
//                  user_answer(jsonb array of 0-based option indices), is_correct,
//                  time_spent, flagged, answered_at, created_at
//
// There is NO exam_questions or user_answers table — exam_answers IS the per-question
// row for an exam (order_index gives ordering, user_answer the response).
const pool = require('../database/pool');
const Exam = require('../models/Exam');
const QuestionService = require('./questionService');
const UserService = require('./userService');
const logger = require('../utils/logger');

// ExamMode values accepted by the DB enum. UI-only modes (e.g. failed_questions)
// are stored as 'practice'.
const DB_EXAM_MODES = new Set(['practice', 'timed', 'review', 'simulation']);
const toDbMode = (mode) => (DB_EXAM_MODES.has(mode) ? mode : 'practice');

class ExamService {
  constructor() {
    // Reuse the shared pool wrapper (handles DATABASE_URL + SSL for Railway).
    this.pool = pool;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  // Correct option indices (0-based) for a question.
  async _getCorrectIndices(client, questionId) {
    const res = await client.query(
      `SELECT order_index FROM question_options
       WHERE question_id = $1 AND is_correct = true
       ORDER BY order_index`,
      [questionId]
    );
    // order_index is 1-based in the DB; the client/exam model uses 0-based.
    return res.rows.map((r) => r.order_index - 1);
  }

  _isAnswerCorrect(answerArr, correctIndices) {
    const a = [...answerArr].map(Number).sort((x, y) => x - y);
    const b = [...correctIndices].map(Number).sort((x, y) => x - y);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Creation
  // ──────────────────────────────────────────────────────────────────────────

  async createExam(examConfig, userId = null, sessionId = null) {
    if (!userId && !sessionId) {
      throw new Error('Either userId or sessionId is required');
    }

    const certificationId = parseInt(examConfig.certification, 10);
    if (Number.isNaN(certificationId)) {
      throw new Error('Certification must be a numeric ID');
    }

    const client = await this.pool.connect();
    try {
      // Certification info + per-cert exam config (COALESCE defaults keep this
      // working before the post-migration script populates the columns).
      const certResult = await client.query(
        `SELECT c.id, c.name, c.code,
                COALESCE(c.num_questions, 60)    AS num_questions,
                COALESCE(c.duration_minutes, 90) AS duration_minutes,
                COALESCE(c.passing_score, 70)    AS passing_score,
                p.name AS provider_name
         FROM certifications c
         JOIN providers p ON c.provider_id = p.id
         WHERE c.id = $1 AND c.is_active = true`,
        [certificationId]
      );
      if (certResult.rows.length === 0) {
        throw new Error(`No active certification found for ID ${certificationId}`);
      }
      const cert = certResult.rows[0];

      // How many questions: explicit request → cert config → default.
      const requestedCount =
        parseInt(examConfig.questionCount, 10) || cert.num_questions || 60;
      const timeLimit =
        parseInt(examConfig.timeLimit, 10) || cert.duration_minutes || 90;
      const passingScore = examConfig.passingScore || cert.passing_score || 70;
      const dbMode = toDbMode(examConfig.mode);

      // Draw questions (Question model instances, options already joined,
      // only active + approved). Filter by certification id.
      const questionObjs = await QuestionService.getRandomQuestions(requestedCount, {
        certification: certificationId,
        category: examConfig.category,
      });
      if (!questionObjs || questionObjs.length === 0) {
        throw new Error(
          `No questions available for certification ID ${certificationId}`
        );
      }

      const title = `${cert.provider_name} - ${cert.name}`;
      const settings = {
        showExplanations: examConfig.settings?.showExplanations ?? dbMode === 'practice',
        randomizeQuestions: examConfig.settings?.randomizeQuestions !== false,
        randomizeAnswers: examConfig.settings?.randomizeAnswers === true,
        allowPause: examConfig.settings?.allowPause ?? dbMode === 'practice',
        allowReview: examConfig.settings?.allowReview ?? dbMode === 'practice',
        ...examConfig.settings,
      };

      await client.query('BEGIN');

      const examInsert = await client.query(
        `INSERT INTO exams (
           user_id, session_id, certification_id, title, mode, question_count,
           time_limit, passing_score, status, settings, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5::"ExamMode", $6, $7, $8, 'pending', $9::jsonb, NOW(), NOW())
         RETURNING *`,
        [
          userId,
          sessionId,
          cert.id,
          title,
          dbMode,
          questionObjs.length,
          timeLimit,
          passingScore,
          JSON.stringify(settings),
        ]
      );
      const examRow = examInsert.rows[0];

      // One exam_answers row per question (the exam's question set + ordering).
      const ordered = settings.randomizeQuestions
        ? [...questionObjs].sort(() => 0.5 - Math.random())
        : questionObjs;

      for (let i = 0; i < ordered.length; i++) {
        await client.query(
          `INSERT INTO exam_answers (exam_id, question_id, order_index, created_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (exam_id, question_id) DO NOTHING`,
          [examRow.id, ordered[i].id, i + 1]
        );
      }

      await client.query('COMMIT');

      logger.info('Exam created', {
        examId: examRow.id,
        certificationId: cert.id,
        questionCount: ordered.length,
        userId,
        sessionId,
      });

      // Return the full exam (questions sanitized — no correct answers).
      return await this.getExamById(examRow.id, userId, sessionId);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* not in a transaction */
      }
      logger.error('Error creating exam:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async createFailedQuestionsExam(examConfig, userId = null, sessionId = null) {
    if (!userId) {
      throw new Error('Authentication required for failed questions exam');
    }
    const certificationId = parseInt(examConfig.certification, 10);
    if (Number.isNaN(certificationId)) {
      throw new Error('Certification must be a numeric ID');
    }

    const client = await this.pool.connect();
    try {
      const limit = Math.min(parseInt(examConfig.questionCount, 10) || 20, 50);

      // Questions this user previously got wrong for this certification.
      const failedResult = await client.query(
        `SELECT DISTINCT q.id
         FROM exam_answers ea
         JOIN exams e       ON ea.exam_id = e.id
         JOIN questions q   ON ea.question_id = q.id
         JOIN topics t      ON q.topic_id = t.id
         JOIN certifications c ON t.certification_id = c.id
         WHERE e.user_id = $1
           AND c.id = $2
           AND ea.is_correct = false
           AND q.is_active = true
           AND q.review_status = 'approved'
         ORDER BY RANDOM()
         LIMIT $3`,
        [userId, certificationId, limit]
      );

      if (failedResult.rows.length < 5) {
        const err = new Error(
          `Not enough failed questions found. Minimum 5 required, found ${failedResult.rows.length}`
        );
        err.code = 'NOT_ENOUGH_FAILED';
        throw err;
      }
      const questionIds = failedResult.rows.map((r) => r.id);

      const certResult = await client.query(
        `SELECT c.id, c.name, c.code,
                COALESCE(c.passing_score, 70) AS passing_score,
                p.name AS provider_name
         FROM certifications c
         JOIN providers p ON c.provider_id = p.id
         WHERE c.id = $1`,
        [certificationId]
      );
      if (certResult.rows.length === 0) {
        throw new Error('Certification not found');
      }
      const cert = certResult.rows[0];

      const timeLimit = Math.max(Math.ceil(questionIds.length * 1.5), 10);
      const title = `${cert.provider_name} - ${cert.name} (Failed questions)`;
      const settings = {
        showExplanations: true,
        randomizeQuestions: true,
        randomizeAnswers: false,
        allowPause: true,
        allowReview: true,
        isFailedQuestionsExam: true,
      };

      await client.query('BEGIN');

      const examInsert = await client.query(
        `INSERT INTO exams (
           user_id, session_id, certification_id, title, mode, question_count,
           time_limit, passing_score, status, settings, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'practice'::"ExamMode", $5, $6, $7, 'pending', $8::jsonb, NOW(), NOW())
         RETURNING *`,
        [
          userId,
          sessionId,
          cert.id,
          title,
          questionIds.length,
          timeLimit,
          cert.passing_score,
          JSON.stringify(settings),
        ]
      );
      const examRow = examInsert.rows[0];

      for (let i = 0; i < questionIds.length; i++) {
        await client.query(
          `INSERT INTO exam_answers (exam_id, question_id, order_index, created_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (exam_id, question_id) DO NOTHING`,
          [examRow.id, questionIds[i], i + 1]
        );
      }

      await client.query('COMMIT');

      return await this.getExamById(examRow.id, userId, sessionId);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* noop */
      }
      logger.error('Error creating failed questions exam:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reads
  // ──────────────────────────────────────────────────────────────────────────

  async getExamById(id, userId = null, sessionId = null) {
    const client = await this.pool.connect();
    try {
      const examResult = await client.query(
        `SELECT e.*,
                c.name AS certification_name,
                c.code AS certification_code,
                COALESCE(c.passing_score, 70) AS cert_passing_score,
                p.name AS provider_name
         FROM exams e
         JOIN certifications c ON e.certification_id = c.id
         JOIN providers p ON c.provider_id = p.id
         WHERE e.id = $1
           AND (
             ($2::INTEGER IS NOT NULL AND e.user_id = $2) OR
             ($3::TEXT    IS NOT NULL AND e.session_id = $3)
           )`,
        [id, userId, sessionId]
      );

      if (examResult.rows.length === 0) {
        logger.warn('Exam not found:', { id, userId, sessionId });
        return null;
      }
      const examRow = examResult.rows[0];

      // Questions for this exam (joined via exam_answers), with options and
      // the user's stored answer.
      const questionsResult = await client.query(
        `SELECT
           q.id,
           q.question_text,
           q.explanation,
           q.difficulty,
           q.points,
           t.name AS topic_name,
           qt.name AS question_type,
           ea.order_index,
           ea.user_answer,
           ea.is_correct,
           ea.flagged,
           COALESCE(
             json_agg(
               json_build_object(
                 'label', qo.option_label,
                 'text', qo.option_text,
                 'order_index', qo.order_index
               ) ORDER BY qo.order_index
             ) FILTER (WHERE qo.id IS NOT NULL),
             '[]'::json
           ) AS options,
           COALESCE(
             array_agg(qo.order_index ORDER BY qo.order_index) FILTER (WHERE qo.is_correct = true),
             ARRAY[]::integer[]
           ) AS correct_order
         FROM exam_answers ea
         JOIN questions q       ON ea.question_id = q.id
         JOIN topics t          ON q.topic_id = t.id
         JOIN question_types qt ON q.question_type_id = qt.id
         LEFT JOIN question_options qo ON q.id = qo.question_id
         WHERE ea.exam_id = $1
         GROUP BY q.id, q.question_text, q.explanation, q.difficulty, q.points,
                  t.name, qt.name, ea.order_index, ea.user_answer, ea.is_correct, ea.flagged
         ORDER BY ea.order_index`,
        [id]
      );

      const questions = [];
      const answers = {};

      for (const row of questionsResult.rows) {
        const isMultipleChoice = row.question_type === 'multiple_choice';
        const correctAnswers = (row.correct_order || []).map((idx) => idx - 1);

        questions.push({
          id: row.id,
          text: row.question_text,
          explanation: row.explanation,
          difficulty: row.difficulty,
          category: row.topic_name,
          provider: examRow.provider_name,
          questionType: row.question_type,
          isMultipleChoice,
          points: parseFloat(row.points) || 1,
          options: row.options || [],
          correctAnswers,
          order: row.order_index,
          isAnswered: row.user_answer !== null && row.user_answer !== undefined,
          isCorrect: row.is_correct,
          flagged: row.flagged,
        });

        // user_answer is stored as a JSONB array of 0-based indices.
        if (row.user_answer !== null && row.user_answer !== undefined) {
          const arr = Array.isArray(row.user_answer) ? row.user_answer : [row.user_answer];
          answers[row.id] = isMultipleChoice ? arr : arr[0];
        }
      }

      const exam = new Exam({
        id: examRow.id,
        userId: examRow.user_id,
        sessionId: examRow.session_id,
        title: examRow.title,
        provider: examRow.provider_name,
        certification: examRow.certification_code,
        certificationId: examRow.certification_id,
        mode: examRow.mode,
        questions,
        answers,
        timeLimit: examRow.time_limit,
        status: examRow.status,
        score: examRow.score != null ? parseFloat(examRow.score) : 0,
        passed: examRow.passed === true,
        passingScore: parseFloat(examRow.passing_score) || parseFloat(examRow.cert_passing_score) || 70,
        startedAt: examRow.started_at,
        completedAt: examRow.completed_at,
        createdAt: examRow.created_at,
        updatedAt: examRow.updated_at,
        settings: examRow.settings || {},
      });

      return exam;
    } catch (error) {
      logger.error('Error getting exam by id:', error);
      return null;
    } finally {
      client.release();
    }
  }

  async getExamForReview(examId, userId = null, sessionId = null) {
    const exam = await this.getExamById(examId, userId, sessionId);
    if (!exam) return null;
    if (exam.status !== 'completed') {
      throw new Error('Only completed exams can be reviewed');
    }
    // correctAnswers are already loaded by getExamById.
    return exam;
  }

  async _listExams(whereCol, whereVal, filters = {}) {
    const client = await this.pool.connect();
    try {
      const whereConditions = [`e.${whereCol} = $1`];
      const params = [whereVal];
      let idx = 2;

      if (filters.status) {
        whereConditions.push(`e.status = $${idx}::"ExamStatus"`);
        params.push(filters.status);
        idx++;
      }
      if (filters.provider) {
        whereConditions.push(`p.name = $${idx}`);
        params.push(filters.provider);
        idx++;
      }

      const result = await client.query(
        `SELECT e.*,
                c.name AS certification_name,
                c.code AS certification_code,
                p.name AS provider_name
         FROM exams e
         JOIN certifications c ON e.certification_id = c.id
         JOIN providers p ON c.provider_id = p.id
         WHERE ${whereConditions.join(' AND ')}
         ORDER BY e.created_at DESC`,
        params
      );

      return result.rows.map(
        (row) =>
          new Exam({
            id: row.id,
            userId: row.user_id,
            sessionId: row.session_id,
            title: row.title,
            provider: row.provider_name,
            certification: row.certification_code,
            certificationId: row.certification_id,
            mode: row.mode,
            timeLimit: row.time_limit,
            status: row.status,
            score: row.score != null ? parseFloat(row.score) : 0,
            passed: row.passed === true,
            passingScore: parseFloat(row.passing_score) || 70,
            totalQuestions: row.question_count,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            questions: [],
            answers: {},
          })
      );
    } catch (error) {
      logger.error('Error listing exams:', error);
      return [];
    } finally {
      client.release();
    }
  }

  async getUserExams(userId, filters = {}) {
    return this._listExams('user_id', userId, filters);
  }

  async getSessionExams(sessionId, filters = {}) {
    return this._listExams('session_id', sessionId, filters);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  async startExam(examId, userId = null, sessionId = null) {
    const client = await this.pool.connect();
    try {
      const exam = await this.getExamById(examId, userId, sessionId);
      if (!exam) throw new Error('Exam not found');
      if (!exam.belongsTo(userId, sessionId)) {
        throw new Error('Unauthorized to access this exam');
      }
      // Allow (re)entering an exam that is pending or already active.
      if (!['not_started', 'in_progress'].includes(exam.status)) {
        throw new Error(`Exam already ${exam.status}`);
      }

      await client.query(
        `UPDATE exams
         SET status = 'active',
             started_at = COALESCE(started_at, NOW()),
             updated_at = NOW()
         WHERE id = $1`,
        [examId]
      );

      return await this.getExamById(examId, userId, sessionId);
    } catch (error) {
      logger.error('Error starting exam:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async submitAnswer(examId, questionId, answer, userId = null, sessionId = null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Ownership check (cheap, avoids loading the whole exam).
      const owner = await client.query(
        `SELECT id FROM exams
         WHERE id = $1
           AND (($2::INTEGER IS NOT NULL AND user_id = $2) OR
                ($3::TEXT    IS NOT NULL AND session_id = $3))`,
        [examId, userId, sessionId]
      );
      if (owner.rows.length === 0) {
        throw new Error('Exam not found');
      }

      // Ensure the question is part of this exam.
      const ea = await client.query(
        `SELECT id FROM exam_answers WHERE exam_id = $1 AND question_id = $2`,
        [examId, questionId]
      );
      if (ea.rows.length === 0) {
        throw new Error('Question not found in exam');
      }

      const answerArr = Array.isArray(answer) ? answer : [answer];
      const correctIndices = await this._getCorrectIndices(client, questionId);
      const isCorrect = this._isAnswerCorrect(answerArr, correctIndices);

      await client.query(
        `UPDATE exam_answers
         SET user_answer = $3::jsonb, is_correct = $4, answered_at = NOW()
         WHERE exam_id = $1 AND question_id = $2`,
        [examId, questionId, JSON.stringify(answerArr), isCorrect]
      );

      await client.query(`UPDATE exams SET updated_at = NOW() WHERE id = $1`, [examId]);
      await client.query('COMMIT');

      return { success: true, isCorrect };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* noop */
      }
      logger.error('Error submitting answer:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Validate an answer WITHOUT persisting (practice "check" button).
  async validateAnswerForExam(examId, questionId, answer, userId = null, sessionId = null) {
    const client = await this.pool.connect();
    try {
      const owner = await client.query(
        `SELECT e.id, COALESCE(ea.id IS NOT NULL, false) AS in_exam
         FROM exams e
         LEFT JOIN exam_answers ea ON ea.exam_id = e.id AND ea.question_id = $4
         WHERE e.id = $1
           AND (($2::INTEGER IS NOT NULL AND e.user_id = $2) OR
                ($3::TEXT    IS NOT NULL AND e.session_id = $3))`,
        [examId, userId, sessionId, questionId]
      );
      if (owner.rows.length === 0) {
        throw new Error('Exam not found');
      }

      const answerArr = Array.isArray(answer) ? answer : [answer];
      const correctIndices = await this._getCorrectIndices(client, questionId);
      const isCorrect = this._isAnswerCorrect(answerArr, correctIndices);

      const explanationRes = await client.query(
        `SELECT explanation FROM questions WHERE id = $1`,
        [questionId]
      );

      return {
        questionId,
        isCorrect,
        correctAnswers: correctIndices,
        explanation: explanationRes.rows[0]?.explanation || null,
      };
    } catch (error) {
      logger.error('Error validating answer:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeExam(examId, userId = null, sessionId = null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const examRes = await client.query(
        `SELECT e.id, e.user_id, COALESCE(e.passing_score, c.passing_score, 70) AS passing_score
         FROM exams e
         JOIN certifications c ON e.certification_id = c.id
         WHERE e.id = $1
           AND (($2::INTEGER IS NOT NULL AND e.user_id = $2) OR
                ($3::TEXT    IS NOT NULL AND e.session_id = $3))`,
        [examId, userId, sessionId]
      );
      if (examRes.rows.length === 0) {
        throw new Error('Exam not found');
      }
      const passingScore = parseFloat(examRes.rows[0].passing_score) || 70;

      const stats = await client.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE is_correct = true)::int AS correct
         FROM exam_answers WHERE exam_id = $1`,
        [examId]
      );
      const total = stats.rows[0].total || 0;
      const correct = stats.rows[0].correct || 0;
      const score = total > 0 ? Math.round((correct / total) * 100) : 0;
      const passed = score >= passingScore;

      await client.query(
        `UPDATE exams
         SET status = 'completed', completed_at = NOW(), score = $2,
             passed = $3, updated_at = NOW()
         WHERE id = $1`,
        [examId, score, passed]
      );

      await client.query('COMMIT');

      // Best-effort stats update for authenticated users.
      if (userId) {
        try {
          await UserService.updateUserStats(userId, {
            score,
            passed,
            totalQuestions: total,
            correctAnswers: correct,
          });
        } catch (statErr) {
          logger.error('Error updating user stats (non-fatal):', statErr);
        }
      }

      return await this.getExamById(examId, userId, sessionId);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* noop */
      }
      logger.error('Error completing exam:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getExamResults(examId, userId = null, sessionId = null) {
    const exam = await this.getExamById(examId, userId, sessionId);
    if (!exam) throw new Error('Exam not found');
    if (!exam.belongsTo(userId, sessionId)) {
      throw new Error('Unauthorized to access this exam');
    }
    if (exam.status !== 'completed') {
      throw new Error('Exam not completed yet');
    }
    return exam.getResults();
  }

  async deleteExam(id, userId = null, sessionId = null) {
    const client = await this.pool.connect();
    try {
      const exam = await this.getExamById(id, userId, sessionId);
      if (!exam) throw new Error('Exam not found');
      if (!exam.belongsTo(userId, sessionId)) {
        throw new Error('Unauthorized to access this exam');
      }
      // exam_answers rows cascade on delete.
      await client.query(`DELETE FROM exams WHERE id = $1`, [id]);
      logger.info('Exam deleted:', { id, userId, sessionId });
    } catch (error) {
      logger.error('Error deleting exam:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Status transitions (pause / resume / cancel) + flag
  // ──────────────────────────────────────────────────────────────────────────

  async setExamStatus(examId, dbStatus, extraSets = '') {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE exams
         SET status = $2::"ExamStatus", updated_at = NOW()${extraSets ? ', ' + extraSets : ''}
         WHERE id = $1`,
        [examId, dbStatus]
      );
    } finally {
      client.release();
    }
  }

  async toggleQuestionFlag(examId, questionId) {
    const client = await this.pool.connect();
    try {
      const res = await client.query(
        `UPDATE exam_answers
         SET flagged = NOT COALESCE(flagged, false)
         WHERE exam_id = $1 AND question_id = $2
         RETURNING flagged`,
        [examId, questionId]
      );
      if (res.rows.length === 0) {
        throw new Error('Question not found in this exam');
      }
      return res.rows[0].flagged;
    } finally {
      client.release();
    }
  }

  async close() {
    // Shared pool is closed by the app shutdown handler.
  }
}

module.exports = new ExamService();
