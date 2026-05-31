const ExamService = require('../services/examService');
const Exam = require('../models/Exam');
const logger = require('../utils/logger');
const telemetry = require('../services/telemetryService');
const reviewService = require('../services/reviewService');
const studyPlanService = require('../services/studyPlanService');

const createExam = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;

    // Validate the request against the Exam model rules.
    const validationErrors = Exam.validate(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validationErrors
      });
    }

    const exam = await ExamService.createExam(req.body, userId, sessionId);

    // Don't leak correct answers / explanations on creation.
    const examData = exam.toJSON();
    examData.questions = examData.questions.map(q => ({
      ...q,
      correctAnswers: undefined,
      explanation: undefined
    }));

    telemetry.trackExamEvent({
      examId: exam.id,
      eventType: 'exam_created',
      req,
      metadata: { mode: exam.mode, questionCount: examData.questions.length },
    }).catch(() => {});

    res.status(201).json({
      success: true,
      data: examData,
      sessionId: sessionId || undefined,
      message: 'Exam created successfully'
    });
  } catch (error) {
    logger.error('Error in createExam controller:', error);
    if (error.message && error.message.includes('No questions available')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    if (error.message && error.message.includes('certification')) {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: 'Failed to create exam' });
  }
};

const createFailedQuestionsExam = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;

    const exam = await ExamService.createFailedQuestionsExam(req.body, userId, sessionId);

    const examData = exam.toJSON();
    examData.questions = examData.questions.map(q => ({
      ...q,
      correctAnswers: undefined,
      explanation: undefined
    }));

    res.status(201).json({
      success: true,
      data: examData,
      message: `Failed questions exam created with ${examData.questions.length} questions`
    });
  } catch (error) {
    logger.error('Error in createFailedQuestionsExam controller:', error);
    if (error.code === 'NOT_ENOUGH_FAILED') {
      return res.status(400).json({ success: false, error: error.message });
    }
    if (error.message && error.message.includes('Authentication required')) {
      return res.status(401).json({ success: false, error: error.message });
    }
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(500).json({
      success: false,
      error: 'Server error while creating failed questions exam'
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
    const analysis = typeof exam.getAnalysis === 'function' ? exam.getAnalysis() : null;

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

    const analysis = typeof exam.getAnalysis === 'function' ? exam.getAnalysis() : null;
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
            multipleChoice: progress.multipleChoiceProgress,
            singleChoice: progress.singleChoiceProgress
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
      return res.status(404).json({ success: false, error: 'Exam not found' });
    }
    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({ success: false, error: 'Unauthorized to access this exam' });
    }
    if (exam.status !== 'in_progress') {
      return res.status(400).json({ success: false, error: 'Only active exams can be paused' });
    }

    await ExamService.setExamStatus(req.params.id, 'paused', 'paused_at = NOW()');

    res.json({
      success: true,
      message: 'Exam paused successfully',
      data: { examId: exam.id, status: 'paused', pausedAt: new Date().toISOString() }
    });

    telemetry.trackExamEvent({ examId: exam.id, eventType: 'exam_paused', req }).catch(() => {});
  } catch (error) {
    logger.error('Pause exam error:', error);
    res.status(500).json({ success: false, error: 'Server error while pausing exam' });
  }
};

const resumeExam = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;

    const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
    if (!exam) {
      return res.status(404).json({ success: false, error: 'Exam not found' });
    }
    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({ success: false, error: 'Unauthorized to access this exam' });
    }
    if (exam.status !== 'paused') {
      return res.status(400).json({ success: false, error: 'Only paused exams can be resumed' });
    }

    await ExamService.setExamStatus(req.params.id, 'active');
    const updatedExam = await ExamService.getExamById(req.params.id, userId, sessionId);

    res.json({
      success: true,
      message: 'Exam resumed successfully',
      data: {
        exam: updatedExam.getSummary(),
        timeRemaining: updatedExam.getTimeRemaining()
      }
    });

    telemetry.trackExamEvent({ examId: exam.id, eventType: 'exam_resumed', req }).catch(() => {});
  } catch (error) {
    logger.error('Resume exam error:', error);
    res.status(500).json({ success: false, error: 'Server error while resuming exam' });
  }
};

const cancelExam = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;

    const exam = await ExamService.getExamById(req.params.id, userId, sessionId);
    if (!exam) {
      return res.status(404).json({ success: false, error: 'Exam not found' });
    }
    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({ success: false, error: 'Unauthorized to access this exam' });
    }

    const cancelableStatuses = ['not_started', 'in_progress', 'paused'];
    if (!cancelableStatuses.includes(exam.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot cancel exam with status: ${exam.status}`
      });
    }

    // DB enum uses 'abandoned' for cancelled exams.
    await ExamService.setExamStatus(req.params.id, 'abandoned', 'completed_at = NOW()');

    logger.info(`Exam cancelled: ${req.params.id} by user: ${userId || sessionId}`);

    res.json({
      success: true,
      message: 'Exam cancelled successfully',
      data: { examId: exam.id, status: 'cancelled', cancelledAt: new Date().toISOString() }
    });

    telemetry.trackExamEvent({
      examId: exam.id,
      eventType: 'exam_cancelled',
      req,
      metadata: { previousStatus: exam.status },
    }).catch(() => {});
  } catch (error) {
    logger.error('Cancel exam error:', error);
    res.status(500).json({ success: false, error: 'Server error while cancelling exam' });
  }
};

const toggleQuestionFlag = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;
    const examId = req.params.id;
    const questionId = req.params.questionId || req.body.questionId;

    if (!questionId) {
      return res.status(400).json({ success: false, error: 'Question ID is required' });
    }

    const exam = await ExamService.getExamById(examId, userId, sessionId);
    if (!exam) {
      return res.status(404).json({ success: false, error: 'Exam not found' });
    }
    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({ success: false, error: 'Unauthorized to access this exam' });
    }
    if (!['active', 'in_progress'].includes(exam.status)) {
      return res.status(400).json({ success: false, error: 'Can only flag questions in active exams' });
    }

    let isFlagged;
    try {
      isFlagged = await ExamService.toggleQuestionFlag(examId, questionId);
    } catch (e) {
      if (e.message && e.message.includes('not found')) {
        return res.status(404).json({ success: false, error: 'Question not found in this exam' });
      }
      throw e;
    }

    res.json({
      success: true,
      data: {
        questionId,
        isFlagged,
        message: isFlagged ? 'Question flagged for review' : 'Question unflagged'
      }
    });

    telemetry.trackExamEvent({
      examId,
      eventType: isFlagged ? 'exam_question_flagged' : 'exam_question_unflagged',
      req,
      metadata: { questionId },
    }).catch(() => {});
  } catch (error) {
    logger.error('Toggle question flag error:', error);
    res.status(500).json({ success: false, error: 'Server error while toggling question flag' });
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