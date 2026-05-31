const ExamService = require('../services/examService');
const Exam = require('../models/Exam');
const logger = require('../utils/logger');
const telemetry = require('../services/telemetryService');
const reviewService = require('../services/reviewService');
const studyPlanService = require('../services/studyPlanService');

const createExam = async (req, res) => {
  try {
    const {
      provider,
      certification,
      questionCount = 10,
      difficulty,
      mode = 'practice',
      timeLimit,
      passingScore
    } = req.body;

    // Build the question set with the schema-aware service. It returns Question
    // models with their options already joined from question_options, and only
    // active + approved questions. We draw randomly from the whole certification
    // (the cert-level "difficulty" is not a per-question filter).
    const questionObjs = await QuestionService.getRandomQuestions(
      parseInt(questionCount) || 10,
      { certification }
    );

    if (!questionObjs || questionObjs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No questions available for the specified criteria'
      });
    }

    // Sanitized = no correct answers leaked to the client.
    const formattedQuestions = questionObjs.map(q => q.getSanitized());

    // Certification info using the CURRENT schema columns (num_questions /
    // duration_minutes / passing_score were added by the post-migration script;
    // COALESCE keeps this working even before they are populated).
    const certQuery = `
      SELECT
        c.id, c.name, c.code, c.description, c.difficulty,
        COALESCE(c.num_questions, 60)    as num_questions,
        COALESCE(c.duration_minutes, 90) as duration_minutes,
        COALESCE(c.passing_score, 70)    as passing_score,
        p.name as provider_name
      FROM certifications c
      JOIN providers p ON c.provider_id = p.id
      WHERE c.id = $1
    `;
    const certResult = await pool.query(certQuery, [certification]);

    if (certResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Certification not found'
      });
    }
    const certificationData = certResult.rows[0];

    const finalTimeLimit = timeLimit || certificationData.duration_minutes || 120;
    const finalPassingScore = passingScore || certificationData.passing_score || 70;

    // Persist the exam only for authenticated users.
    let examId = null;
    if (req.user && req.user.id) {
      const examResult = await pool.query(
        `INSERT INTO exams (
           user_id, certification_id, title, mode, status, total_questions,
           passing_score, time_limit_minutes, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'created', $5, $6, $7, NOW(), NOW())
         RETURNING id`,
        [
          req.user.id,
          certification,
          `${certificationData.provider_name} - ${certificationData.name}`,
          mode,
          formattedQuestions.length,
          finalPassingScore,
          finalTimeLimit
        ]
      );
      examId = examResult.rows[0].id;
    }

    res.json({
      success: true,
      data: {
        examId,
        questions: formattedQuestions,
        certification: certificationData,
        totalQuestions: formattedQuestions.length,
        timeLimit: finalTimeLimit,
        passingScore: finalPassingScore
      }
    });
  } catch (error) {
    logger.error('Error creating exam:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create exam'
    });
  }
};

const createFailedQuestionsExam = async (req, res) => {
  try {
    const { certification, questionCount = 20 } = req.body;

    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for failed questions exam'
      });
    }

    // Failed questions for this user + certification, with their options
    // (current schema: options live in question_options, difficulty is q.difficulty).
    const failedQuery = `
      SELECT
        q.id,
        q.question_text as text,
        q.explanation,
        q.difficulty,
        q.points,
        q.topic_id,
        COALESCE(
          json_agg(
            json_build_object(
              'label', qo.option_label,
              'text', qo.option_text,
              'order_index', qo.order_index
            ) ORDER BY qo.order_index
          ) FILTER (WHERE qo.id IS NOT NULL),
          '[]'::json
        ) as options
      FROM questions q
      JOIN topics t ON q.topic_id = t.id
      JOIN certifications c ON t.certification_id = c.id
      JOIN exam_answers ea ON q.id = ea.question_id
      JOIN exams e ON ea.exam_id = e.id
      LEFT JOIN question_options qo ON q.id = qo.question_id
      WHERE e.user_id = $1 AND ea.is_correct = false
        AND c.id = $2 AND q.is_active = true AND q.review_status = 'approved'
      GROUP BY q.id, q.question_text, q.explanation, q.difficulty, q.points, q.topic_id
      ORDER BY RANDOM()
      LIMIT $3
    `;
    const failedResult = await pool.query(failedQuery, [req.user.id, certification, questionCount]);

    const formattedQuestions = failedResult.rows.map(q => ({
      id: q.id,
      text: q.text,
      question: q.text,
      options: q.options,
      explanation: q.explanation,
      difficulty: q.difficulty,
      points: q.points,
      topicId: q.topic_id
    }));

    if (formattedQuestions.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No failed questions found for this certification'
      });
    }

    // Certification info (current schema columns).
    const certResult = await pool.query(`
      SELECT
        c.id, c.name, c.code, c.description, c.difficulty,
        COALESCE(c.num_questions, 60)    as num_questions,
        COALESCE(c.duration_minutes, 90) as duration_minutes,
        COALESCE(c.passing_score, 70)    as passing_score,
        p.name as provider_name
      FROM certifications c
      JOIN providers p ON c.provider_id = p.id
      WHERE c.id = $1
    `, [certification]);
    const certificationData = certResult.rows[0] || null;

    const finalPassingScore = certificationData ? certificationData.passing_score : 70;
    const finalTimeLimit = Math.max(Math.ceil(formattedQuestions.length * 1.5), 10);

    const examResult = await pool.query(
      `INSERT INTO exams (
         user_id, certification_id, title, mode, status, total_questions,
         passing_score, time_limit_minutes, created_at, updated_at
       ) VALUES ($1, $2, $3, 'practice', 'created', $4, $5, $6, NOW(), NOW())
       RETURNING id`,
      [
        req.user.id,
        certification,
        certificationData
          ? `${certificationData.provider_name} - ${certificationData.name}`
          : 'Failed questions',
        formattedQuestions.length,
        finalPassingScore,
        finalTimeLimit
      ]
    );
    const examId = examResult.rows[0].id;

    res.json({
      success: true,
      data: {
        examId,
        questions: formattedQuestions,
        certification: certificationData,
        totalQuestions: formattedQuestions.length,
        timeLimit: finalTimeLimit,
        passingScore: finalPassingScore
      }
    });
  } catch (error) {
    logger.error('Error creating failed questions exam:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create failed questions exam'
    });
  }
};
const getUserExams = async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      provider: req.query.provider
    };

    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;

    let exams;
    if (userId) {
      // Usuario autenticado
      exams = await ExamService.getUserExams(userId, filters);
    } else if (sessionId) {
      // Usuario anónimo
      exams = await ExamService.getSessionExams(sessionId, filters);
    } else {
      exams = [];
    }

    // Convertir a formato JSON con resúmenes
    const examSummaries = exams.map(exam => ({
      ...exam.toJSON(),
      questions: exam.questions.length, // Solo el número de preguntas en el listado
      questionDetails: undefined // No incluir detalles de preguntas en el listado
    }));

    res.json({
      success: true,
      data: examSummaries,
      count: examSummaries.length
    });
  } catch (error) {
    logger.error('Get user exams error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while retrieving exams'
    });
  }
};

const getExamById = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    logger.debug('Get exam request:', {
      examId: req.params.id,
      userId,
      sessionId
    });
    
    const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
    
    if (!exam) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    // Verificar autorización
    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this exam'
      });
    }

    // No incluir respuestas correctas si el examen está en progreso
    const examData = exam.toJSON();
    if (exam.status === 'in_progress' || exam.status === 'not_started') {
      examData.questions = examData.questions.map(question => ({
        ...question,
        correctAnswers: undefined,
        explanation: undefined
      }));
    }

    res.json({
      success: true,
      data: examData
    });
  } catch (error) {
    logger.error('Get exam error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while retrieving exam'
    });
  }
};

const startExam = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    logger.info('Start exam request:', {
      examId: req.params.id,
      userId,
      sessionId
    });
    
    const exam = await ExamService.startExam(req.params.id, userId, sessionId);

    // No incluir respuestas correctas cuando se inicia el examen
    const examData = exam.toJSON();
    examData.questions = examData.questions.map(question => ({
      ...question,
      correctAnswers: undefined,
      explanation: undefined
    }));

    // Telemetry: track exam start
    telemetry.trackExamEvent({
      examId: exam.id,
      eventType: 'exam_started',
      req,
      metadata: { questionCount: examData.questions?.length, mode: exam.mode },
    }).catch(() => {});

    res.json({
      success: true,
      data: examData,
      message: 'Exam started successfully'
    });
  } catch (error) {
    logger.error('Start exam error:', error);
    
    if (error.message.includes('not found') || error.message.includes('Unauthorized')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    if (error.message.includes('already started') || error.message.includes('completed')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Server error while starting exam'
    });
  }
};

// ACTUALIZADO: Mejorar validación de respuestas múltiples para PostgreSQL
const submitAnswer = async (req, res) => {
  try {
    const { questionId, answer } = req.body;

    if (!questionId || answer === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Question ID and answer are required'
      });
    }

    // Validación adicional del formato de respuesta
    if (Array.isArray(answer)) {
      // Validar array de respuestas para preguntas múltiples
      if (answer.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'At least one answer must be selected'
        });
      }
      
      // Validar que todos los elementos sean números enteros válidos
      if (!answer.every(item => Number.isInteger(item) && item >= 0)) {
        return res.status(400).json({
          success: false,
          error: 'All answer indices must be non-negative integers'
        });
      }
      
      // Eliminar duplicados y validar
      const uniqueAnswers = [...new Set(answer)];
      if (uniqueAnswers.length !== answer.length) {
        logger.warn('Duplicate answers detected, removing duplicates:', {
          original: answer,
          cleaned: uniqueAnswers
        });
      }
    } else {
      // Validar respuesta única
      if (!Number.isInteger(answer) || answer < 0) {
        return res.status(400).json({
          success: false,
          error: 'Answer must be a non-negative integer'
        });
      }
    }

    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;

    // Opcional: Validar la respuesta antes de enviarla
    try {
      const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
      if (exam) {
        exam.validateAnswer(questionId, answer);
      }
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        error: `Answer validation failed: ${validationError.message}`
      });
    }

    const result = await ExamService.submitAnswer(
      req.params.id,
      questionId,
      answer,
      userId,
      sessionId
    );

    // Telemetry: track answer + question event
    telemetry.trackExamEvent({
      examId: req.params.id,
      eventType: 'exam_answer_submitted',
      req,
      metadata: {
        questionId,
        isCorrect: result?.isCorrect ?? null,
      },
    }).catch(() => {});
    telemetry.trackQuestionEvent({
      questionId,
      eventType: 'answered',
      isCorrect: result?.isCorrect ?? null,
      timeSpent: result?.timeSpent ?? null,
      req,
      metadata: { examId: req.params.id },
    }).catch(() => {});

    // Update spaced-repetition schedule (auth users only). Fire-and-forget;
    // a DB failure here must never block the answer response.
    if (req.user?.id && result?.isCorrect !== undefined && result?.isCorrect !== null) {
      reviewService
        .recordAnswer(req.user.id, questionId, !!result.isCorrect)
        .catch((err) => logger.warn('reviewService.recordAnswer failed:', err?.message));

      // Bump the active study plan counter (if any). Same fire-and-forget
      // pattern — the user's answer must persist regardless of whether
      // they happen to have a plan for this cert.
      const certId = result?.certificationId || req.body?.certificationId;
      if (certId) {
        studyPlanService
          .recordAnswered(req.user.id, certId)
          .catch((err) => logger.warn('studyPlanService.recordAnswered failed:', err?.message));
      }
    }

    res.json({
      success: true,
      data: result,
      message: 'Answer submitted successfully'
    });
  } catch (error) {
    logger.error('Submit answer error:', error);
    
    if (error.message.includes('not found') || error.message.includes('Unauthorized')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    if (error.message.includes('not in progress')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    if (error.message.includes('Invalid answer') || error.message.includes('Too many answers')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    // Error específico de PostgreSQL
    if (error.code === '23503') { // Foreign key violation
      return res.status(400).json({
        success: false,
        error: 'Invalid question or answer reference'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Server error while submitting answer'
    });
  }
};

const completeExam = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    logger.info('Complete exam request:', {
      examId: req.params.id,
      userId,
      sessionId
    });
    
    const exam = await ExamService.completeExam(req.params.id, userId, sessionId);

    // Incluir todas las respuestas correctas y explicaciones en el examen completado
    const examData = exam.toJSON();
    const results = exam.getResults();
    const analysis = exam.getAnalysis();

    // Telemetry: track exam completion
    telemetry.trackExamEvent({
      examId: exam.id,
      eventType: 'exam_completed',
      req,
      metadata: {
        score: exam.score,
        passed: exam.passed,
        timeSpent: exam.timeSpent,
        totalQuestions: results?.totalQuestions,
        correctAnswers: results?.correctAnswers,
      },
    }).catch(() => {});

    res.json({
      success: true,
      data: {
        exam: examData,
        results: results,
        analysis: analysis
      },
      message: `Exam completed successfully. Score: ${exam.score}% - ${exam.passed ? 'PASSED' : 'FAILED'}`
    });
  } catch (error) {
    logger.error('Complete exam error:', error);
    
    if (error.message.includes('not found') || error.message.includes('Unauthorized')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    if (error.message.includes('not in progress')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    // Error específico de PostgreSQL
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({
        success: false,
        error: 'Exam has already been completed'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Server error while completing exam'
    });
  }
};

const getExamResults = async (req, res) => {
 try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    logger.debug('Get exam results request:', {
      examId: req.params.id,
      userId,
      sessionId
    });
    
    const results = await ExamService.getExamResults(req.params.id, userId, sessionId);
    const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
    
    if (!exam) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    const analysis = exam.getAnalysis();
    const summary = exam.getSummary();
    
    // Incluir información adicional para revisión
    const enhancedResults = {
      results: results,
      analysis: analysis,
      examSummary: summary,
      // Datos adicionales para el componente de revisión
      reviewData: {
        examId: exam.id,
        title: exam.title,
        provider: exam.provider,
        certification: exam.certification,
        examMode: exam.examMode || 'practice',
        totalQuestions: exam.questions.length,
        status: exam.status,
        createdAt: exam.createdAt,
        completedAt: exam.completedAt,
        // Resumen de respuestas por pregunta
        questionSummary: exam.questions.map((question, index) => ({
          questionId: question.id,
          index: index,
          text: question.text.substring(0, 100) + '...',
          isAnswered: exam.answers[question.id] !== undefined,
          userAnswer: exam.answers[question.id],
          category: question.category,
          difficulty: question.difficulty
        }))
      }
    };
    
    res.json({
      success: true,
      data: enhancedResults
    });
  } catch (error) {
    logger.error('Get exam results error:', error);
    
    if (error.message.includes('not found') || error.message.includes('Unauthorized')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    if (error.message.includes('not completed')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Server error while retrieving exam results'
    });
  }
};


const getExamForReview = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    console.log('Getting exam for review:', {
      examId: req.params.id,
      userId,
      sessionId
    });
    
    const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
    
    if (!exam) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    // Verificar autorización
    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this exam'
      });
    }

    // Para revisión, incluir todas las respuestas correctas
    const examData = exam.toJSON();
    
    console.log('Exam data for review:', {
      id: examData.id,
      questionsCount: examData.questions?.length || 0,
      status: examData.status
    });

    res.json({
      success: true,
      data: examData
    });
  } catch (error) {
    console.error('Get exam for review error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while retrieving exam for review'
    });
  }
};

const deleteExam = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    logger.info('Delete exam request:', {
      examId: req.params.id,
      userId,
      sessionId
    });
    
    await ExamService.deleteExam(req.params.id, userId, sessionId);

    res.json({
      success: true,
      message: 'Exam deleted successfully'
    });
  } catch (error) {
    logger.error('Delete exam error:', error);
    
    if (error.message.includes('not found') || error.message.includes('Unauthorized')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    // Error específico de PostgreSQL para referencias
    if (error.code === '23503') { // Foreign key violation
      return res.status(400).json({
        success: false,
        error: 'Cannot delete exam with existing references'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Server error while deleting exam'
    });
  }
};

// ACTUALIZADO: Obtener progreso del examen con datos de PostgreSQL
const getExamProgress = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
    
    if (!exam) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    // Verificar autorización
    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this exam'
      });
    }

    const progress = exam.getProgress();
    const summary = exam.getSummary();

    res.json({
      success: true,
      data: {
        examId: exam.id,
        status: exam.status,
        progress: progress,
        timeRemaining: exam.getTimeRemaining(),
        isTimeExpired: exam.isTimeExpired(),
        summary: summary,
        // Información adicional de PostgreSQL
        statistics: {
          totalQuestions: exam.questions.length,
          answeredQuestions: progress.answeredQuestions,
          correctAnswers: progress.correctAnswers,
          incorrectAnswers: progress.incorrectAnswers,
          accuracyRate: progress.accuracyPercentage
        }
      }
    });
  } catch (error) {
    logger.error('Get exam progress error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while retrieving exam progress'
    });
  }
};

// ACTUALIZADO: Validar respuesta antes de enviarla (compatible con PostgreSQL)
const validateAnswer = async (req, res) => {
  try {
    const { questionId, answer } = req.body;
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    if (!questionId || answer === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Question ID and answer are required for validation'
      });
    }
    
    const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
    
    if (!exam) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this exam'
      });
    }

    if (exam.status !== 'in_progress') {
      return res.status(400).json({
        success: false,
        error: 'Exam is not in progress'
      });
    }

    try {
      const validatedAnswer = exam.validateAnswer(questionId, answer);
      
      // Información adicional sobre la pregunta para ayudar al frontend
      const question = exam.questions.find(q => q.id === questionId);
      const isMultiple = question ? (question.isMultipleChoice || question.questionType === 'multiple_answer') : false;
      
      res.json({
        success: true,
        data: {
          isValid: true,
          validatedAnswer: validatedAnswer,
          questionInfo: {
            id: questionId,
            isMultipleChoice: isMultiple,
            expectedAnswers: question ? question.expectedAnswers : 1,
            totalOptions: question ? question.options.length : 0
          }
        }
      });
    } catch (validationError) {
      res.json({
        success: true,
        data: {
          isValid: false,
          error: validationError.message,
          errorCode: 'VALIDATION_FAILED'
        }
      });
    }
  } catch (error) {
    logger.error('Validate answer error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while validating answer'
    });
  }
};

// NUEVO: Obtener estadísticas del examen para dashboard
const getExamStatistics = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
    
    if (!exam) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this exam'
      });
    }

    const results = exam.getResults();
    const progress = exam.getProgress();

    res.json({
      success: true,
      data: {
        overview: {
          examId: exam.id,
          title: exam.title,
          status: exam.status,
          score: exam.score,
          passed: exam.passed,
          timeSpent: exam.timeSpent,
          timeLimit: exam.timeLimit
        },
        performance: {
          totalQuestions: results.totalQuestions,
          correctAnswers: results.correctAnswers,
          incorrectAnswers: results.incorrectAnswers,
          unansweredQuestions: results.unansweredQuestions,
          accuracyRate: progress.accuracyPercentage
        },
        breakdown: {
          byCategory: results.categoryStats,
          byDifficulty: results.difficultyStats,
          byQuestionType: {
            multipleChoice: results.multipleChoiceStats,
            singleChoice: results.singleChoiceStats
          }
        },
        timeAnalysis: {
          efficiency: results.efficiency,
          averageTimePerQuestion: exam.timeSpent > 0 ? 
            Math.round((exam.timeSpent * 60) / results.totalQuestions) : 0,
          timeUtilization: exam.timeLimit > 0 ? 
            Math.round((exam.timeSpent / exam.timeLimit) * 100) : 0
        }
      }
    });
  } catch (error) {
    logger.error('Get exam statistics error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while retrieving exam statistics'
    });
  }
};

// NUEVO: Pausar examen (útil para exámenes largos)
const pauseExam = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
    
    if (!exam) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this exam'
      });
    }

    if (exam.status !== 'in_progress') {
      return res.status(400).json({
        success: false,
        error: 'Only active exams can be paused'
      });
    }

    // Actualizar estado a pausado en la base de datos
    const client = await ExamService.pool.connect();
    try {
      await client.query(`
        UPDATE exams 
        SET status = 'paused', updated_at = CURRENT_TIMESTAMP 
        WHERE id = $1
      `, [req.params.id]);
      
      res.json({
        success: true,
        message: 'Exam paused successfully',
        data: {
          examId: exam.id,
          status: 'paused',
          pausedAt: new Date().toISOString()
        }
      });

      telemetry.trackExamEvent({
        examId: exam.id,
        eventType: 'exam_paused',
        req,
      }).catch(() => {});
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Pause exam error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while pausing exam'
    });
  }
};

// NUEVO: Reanudar examen pausado
const resumeExam = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
    
    if (!exam) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this exam'
      });
    }

    if (exam.status !== 'paused') {
      return res.status(400).json({
        success: false,
        error: 'Only paused exams can be resumed'
      });
    }

    // Verificar si el tiempo no ha expirado
    if (exam.isTimeExpired()) {
      return res.status(400).json({
        success: false,
        error: 'Exam time has expired and cannot be resumed'
      });
    }

    // Actualizar estado a activo en la base de datos
    const client = await ExamService.pool.connect();
    try {
      await client.query(`
        UPDATE exams 
        SET status = 'active', updated_at = CURRENT_TIMESTAMP 
        WHERE id = $1
      `, [req.params.id]);
      
      const updatedExam = await ExamService.getExamById(req.params.id, userId, sessionId);
      
      res.json({
        success: true,
        message: 'Exam resumed successfully',
        data: {
          exam: updatedExam.getSummary(),
          timeRemaining: updatedExam.getTimeRemaining()
        }
      });

      telemetry.trackExamEvent({
        examId: exam.id,
        eventType: 'exam_resumed',
        req,
      }).catch(() => {});
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Resume exam error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while resuming exam'
    });
  }
};

// NUEVO: Cancelar examen (abandonar sin completar)
const cancelExam = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    
    const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
    
    if (!exam) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this exam'
      });
    }

    // Solo se pueden cancelar exámenes activos, pausados o pendientes
    const cancelableStatuses = ['pending', 'active', 'in_progress', 'paused'];
    if (!cancelableStatuses.includes(exam.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot cancel exam with status: ${exam.status}`
      });
    }

    // Actualizar estado a cancelado en la base de datos
    const client = await ExamService.pool.connect();
    try {
      await client.query(`
        UPDATE exams 
        SET status = 'cancelled', 
            updated_at = CURRENT_TIMESTAMP,
            completed_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [req.params.id]);
      
      logger.info(`Exam cancelled: ${req.params.id} by user: ${userId || sessionId}`);
      
      res.json({
        success: true,
        message: 'Exam cancelled successfully',
        data: {
          examId: exam.id,
          status: 'cancelled',
          cancelledAt: new Date().toISOString()
        }
      });

      telemetry.trackExamEvent({
        examId: exam.id,
        eventType: 'exam_cancelled',
        req,
        metadata: { previousStatus: exam.status },
      }).catch(() => {});
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Cancel exam error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while cancelling exam'
    });
  }
};

// NUEVO: Toggle flag en una pregunta (marcar para revisión)
const toggleQuestionFlag = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    const examId = req.params.id;
    const questionId = req.params.questionId || req.body.questionId;
    
    if (!questionId) {
      return res.status(400).json({
        success: false,
        error: 'Question ID is required'
      });
    }
    
    const exam = await ExamService.getExamById(examId, userId, sessionId);
    
    if (!exam) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this exam'
      });
    }

    // Solo se pueden marcar preguntas en exámenes activos
    if (!['active', 'in_progress'].includes(exam.status)) {
      return res.status(400).json({
        success: false,
        error: 'Can only flag questions in active exams'
      });
    }

    // Toggle flag en la base de datos
    const client = await ExamService.pool.connect();
    try {
      // Verificar que la pregunta existe en el examen
      const checkQuery = `
        SELECT eq.id, COALESCE(ua.is_flagged, false) as is_flagged
        FROM exam_questions eq
        LEFT JOIN user_answers ua ON eq.id = ua.exam_question_id
        WHERE eq.exam_id = $1 AND eq.question_id = $2
      `;
      const checkResult = await client.query(checkQuery, [examId, questionId]);
      
      if (checkResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Question not found in this exam'
        });
      }

      const examQuestionId = checkResult.rows[0].id;
      const currentFlag = checkResult.rows[0].is_flagged;
      const newFlag = !currentFlag;

      // Actualizar o crear el registro de respuesta con el flag
      const upsertQuery = `
        INSERT INTO user_answers (exam_question_id, is_flagged, answered_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (exam_question_id) 
        DO UPDATE SET is_flagged = $2, answered_at = CURRENT_TIMESTAMP
        RETURNING is_flagged
      `;
      const result = await client.query(upsertQuery, [examQuestionId, newFlag]);
      
      res.json({
        success: true,
        data: {
          questionId,
          isFlagged: result.rows[0].is_flagged,
          message: newFlag ? 'Question flagged for review' : 'Question unflagged'
        }
      });

      telemetry.trackExamEvent({
        examId,
        eventType: newFlag ? 'exam_question_flagged' : 'exam_question_unflagged',
        req,
        metadata: { questionId },
      }).catch(() => {});
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Toggle question flag error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while toggling question flag'
    });
  }
};

module.exports = {
  createExam,
  createFailedQuestionsExam,
  getUserExams,
  getExamById,
  startExam,
  submitAnswer,
  completeExam,
  getExamResults,
  deleteExam,
  getExamProgress,
  validateAnswer,
  getExamForReview,
  getExamStatistics,
  pauseExam,
  resumeExam,
  cancelExam,
  toggleQuestionFlag
};