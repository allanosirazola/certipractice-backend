const ExamService = require('../services/examService');
const Exam = require('../models/Exam');
const logger = require('../utils/logger');

const createExam = async (req, res) => {
  try {
    // ACTUALIZADO: Datos mínimos requeridos para crear un examen
    const {
      provider,
      certification,
      mode = 'practice',
      questionCount,
      timeLimit,
      difficulty,
      category,
      settings = {}
    } = req.body;

    // Crear objeto de datos mínimos para validación
    const minimalExamData = {
      provider,
      certification,
      mode,
      questionCount,
      timeLimit,
      difficulty
    };

    // Validar solo los datos esenciales
    const errors = Exam.validate(minimalExamData);
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: errors.join(', ')
      });
    }

    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;

    // Validar que tengamos userId O sessionId
    if (!userId && !sessionId) {
      logger.error('No userId or sessionId provided for exam creation');
      return res.status(400).json({
        success: false,
        error: 'Session identification required'
      });
    }

    logger.info('Creating exam request:', {
      userId,
      sessionId,
      provider,
      certification,
      mode,
      questionCount: questionCount || 'default'
    });

    // ACTUALIZADO: Pasar solo datos necesarios al servicio
    const examConfig = {
      provider,
      certification,
      mode,
      questionCount,
      timeLimit,
      difficulty,
      category,
      settings: {
        randomizeQuestions: settings.randomizeQuestions !== false,
        randomizeAnswers: settings.randomizeAnswers === true,
        showExplanations: mode === 'practice',
        allowPause: mode === 'practice',
        allowReview: mode === 'practice',
        ...settings
      }
    };

    const exam = await ExamService.createExam(examConfig, userId, sessionId);

    // Establecer sessionId en la respuesta para usuarios anónimos
    if (!userId && sessionId) {
      res.setHeader('X-Session-Id', sessionId);
    }

    res.status(201).json({
      success: true,
      data: exam.toJSON(),
      sessionId: !userId ? sessionId : undefined
    });
  } catch (error) {
    logger.error('Create exam error:', error);
    
    // Manejar errores específicos de PostgreSQL
    if (error.message.includes('No certification found')) {
      return res.status(404).json({
        success: false,
        error: 'Certification not found for the specified provider'
      });
    }
    
    if (error.message.includes('No questions found')) {
      return res.status(404).json({
        success: false,
        error: 'No questions available for the specified criteria'
      });
    }

    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

const createFailedQuestionsExam = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      provider,
      certification, 
      category,
      difficulty,
      questionCount = 20,
      settings = {}
    } = req.body;

    if (!provider || !certification) {
      return res.status(400).json({
        success: false,
        error: 'Provider and certification are required'
      });
    }

    logger.info('Creating failed questions exam:', {
      userId, provider, certification, questionCount, category, difficulty
    });

    const client = await ExamService.pool.connect();
    
    try {
      // Construir condiciones WHERE y parámetros correctamente
      let whereConditions = [
        'e.user_id = $1',
        'ua.is_correct = false',
        'e.status = $2',
        'q.is_active = true',
        'p.id = $3',
        'c.id = $4'
      ];
      
      // Array de parámetros - EXACTAMENTE 4 parámetros
      let queryParams = [
        userId, 
        'completed', 
        provider, 
        parseInt(certification)
      ];

      // Calcular límite de preguntas
      const limitValue = Math.min(parseInt(questionCount), 50);

      // Query principal - usando interpolación directa para LIMIT
      const failedQuestionsQuery = `
        SELECT
          q.id,
          q.question_text,
          q.explanation,
          q.difficulty_level,
          q.expected_answers_count,
          qt.name as question_type,
          t.name as topic_name,
          COUNT(ua.id) as failed_count
        FROM user_answers ua
        JOIN exam_questions eq ON ua.exam_question_id = eq.id
        JOIN questions q ON eq.question_id = q.id
        JOIN question_types qt ON q.question_type_id = qt.id
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        JOIN exams e ON eq.exam_id = e.id
        WHERE ${whereConditions.join(' AND ')}
        GROUP BY q.id, q.question_text, q.explanation, q.difficulty_level, 
                 q.expected_answers_count, qt.name, t.name
        ORDER BY failed_count DESC, RANDOM()
        LIMIT ${limitValue}
      `;

      const failedQuestionsResult = await client.query(failedQuestionsQuery, queryParams);
      const failedQuestions = failedQuestionsResult.rows;

      if (failedQuestions.length < 5) {
        return res.status(400).json({
          success: false,
          error: `Not enough failed questions found. Minimum 5 required, found ${failedQuestions.length}`,
          data: {
            availableQuestions: failedQuestions.length,
            minimumRequired: 5
          }
        });
      }

      // Obtener datos de certificación
      const certQuery = `
        SELECT 
          c.id, c.name, c.code, c.description, c.duration_minutes, 
          c.passing_score, c.total_questions,
          p.name as provider_name, p.description as provider_description
        FROM certifications c
        JOIN providers p ON c.provider_id = p.id
        WHERE c.id = $1 AND c.is_active = true
      `;
      const certResult = await client.query(certQuery, [parseInt(certification)]);
      
      if (certResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Certification not found'
        });
      }

      const certificationData = certResult.rows[0];

      // Construir array de preguntas con opciones
      const questions = [];
      for (const questionRow of failedQuestions) {
        const optionsQuery = `
          SELECT id, option_label, option_text, is_correct, order_index
          FROM question_options
          WHERE question_id = $1
          ORDER BY order_index
        `;

        const optionsResult = await client.query(optionsQuery, [questionRow.id]);

        questions.push({
          id: questionRow.id,
          text: questionRow.question_text,
          explanation: questionRow.explanation,
          difficulty: questionRow.difficulty_level,
          category: questionRow.topic_name,
          provider: certificationData.provider_name,
          questionType: questionRow.question_type,
          isMultipleChoice: questionRow.question_type === 'multiple_answer',
          expectedAnswers: questionRow.expected_answers_count,
          options: optionsResult.rows.map(opt => ({
            label: opt.option_label,
            text: opt.option_text
          })),
          failedCount: questionRow.failed_count
        });
      }

      const timeLimit = Math.ceil(questions.length * 1.5);
      const examTitle = `${certificationData.provider_name} ${certificationData.name} - Preguntas Fallidas`;

      // Crear examen en transacción
      await client.query('BEGIN');

      const insertExamQuery = `
        INSERT INTO exams (
          user_id, certification_id, exam_mode, status,
          total_questions, time_limit_minutes, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *
      `;

      const examValues = [
        userId,
        certificationData.id,
        'failed_questions',
        'pending',
        questions.length,
        timeLimit
      ];

      const examResult = await client.query(insertExamQuery, examValues);
      const examRow = examResult.rows[0];
      const examId = examRow.id;

      // Insertar preguntas del examen
      const insertQuestionsQuery = `
        INSERT INTO exam_questions (exam_id, question_id, question_order)
        VALUES ($1, $2, $3)
      `;

      const orderedQuestions = settings.randomizeQuestions !== false ? 
        questions.sort(() => 0.5 - Math.random()) : questions;

      for (let i = 0; i < orderedQuestions.length; i++) {
        await client.query(insertQuestionsQuery, [
          examId,
          orderedQuestions[i].id,
          i + 1
        ]);
      }

      await client.query('COMMIT');

      // Crear objeto Exam
      const exam = new Exam({
        id: examId,
        userId: userId,
        title: examTitle,
        provider: certificationData.provider_name,
        certification: certificationData.code,
        questions: orderedQuestions,
        timeLimit: timeLimit,
        passingScore: certificationData.passing_score || 70,
        status: 'not_started',
        createdAt: examRow.created_at,
        updatedAt: examRow.updated_at,
        examMode: 'failed_questions',
        settings: {
          showExplanations: true,
          randomizeQuestions: settings.randomizeQuestions !== false,
          randomizeAnswers: settings.randomizeAnswers === true,
          allowPause: true,
          allowReview: true,
          isFailedQuestionsExam: true,
          ...settings
        }
      });

      logger.info('Failed questions exam created successfully:', {
        id: examId,
        title: examTitle,
        userId: userId,
        questionCount: exam.questions.length,
        timeLimit: timeLimit
      });

      res.status(201).json({
        success: true,
        data: exam.toJSON(),
        message: `Failed questions exam created with ${questions.length} questions`
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    logger.error('Create failed questions exam error:', error);
    
    if (error.message.includes('Certification not found')) {
      return res.status(404).json({
        success: false,
        error: 'Certification not found'
      });
    }
    
    if (error.message.includes('Not enough failed questions')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
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
  resumeExam
};