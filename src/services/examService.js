const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const Exam = require('../models/Exam');
const QuestionService = require('./questionService');
const UserService = require('./userService');
const logger = require('../utils/logger');

class ExamService {
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'exam_system',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

 // SIMPLIFICADO: createExam con usuario temporal para sesiones anónimas
  async createExam(examConfig, userId = null, sessionId = null) {
    const client = await this.pool.connect();
    let transactionStarted = false;
    
    try {
      logger.info('Creating exam with config:', {
        userId,
        sessionId,
        provider: examConfig.provider,
        certification: examConfig.certification,
        mode: examConfig.mode
      });

      // Validar que tengamos userId O sessionId
      if (!userId && !sessionId) {
        throw new Error('Either userId or sessionId is required');
      }

      // 🆔 CREAR USUARIO TEMPORAL si no hay usuario autenticado
      let finalUserId = userId;
      
      if (!userId && sessionId) {
        console.log('👤 Creating temporary user for session:', sessionId);
        
        // Crear username único basado en sessionId
        const tempUsername = `temp_${sessionId}`;
        const tempEmail = `${tempUsername}@temp.local`;
        
        try {
          // NUEVO: Verificar primero si ya existe el usuario temporal
          const checkUserResult = await client.query(`
            SELECT id FROM users WHERE username = $1
          `, [tempUsername]);
          
          if (checkUserResult.rows.length > 0) {
            // Usuario temporal ya existe
            finalUserId = checkUserResult.rows[0].id;
            console.log('✅ Using existing temporary user with ID:', finalUserId);
          } else {
            // Crear nuevo usuario temporal
            const createTempUserResult = await client.query(`
              INSERT INTO users (username, email, first_name, last_name, is_active, password_hash)
              VALUES ($1, $2, 'Temp', 'User', true, 'temp_password')
              RETURNING id
            `, [tempUsername, tempEmail]);
            
            finalUserId = createTempUserResult.rows[0].id;
            console.log('✅ Created new temporary user with ID:', finalUserId);
          }
          
        } catch (userError) {
          console.error('❌ Error managing temporary user:', userError);
          
          if (userError.code === '23505') { // Unique violation - intentar obtener existente
            try {
              const getTempUserResult = await client.query(`
                SELECT id FROM users WHERE username = $1
              `, [tempUsername]);
              
              if (getTempUserResult.rows.length > 0) {
                finalUserId = getTempUserResult.rows[0].id;
                console.log('✅ Recovered existing temporary user with ID:', finalUserId);
              } else {
                throw new Error('Could not create or find temporary user');
              }
            } catch (recoveryError) {
              throw new Error(`Failed to create temporary user: ${recoveryError.message}`);
            }
          } else {
            throw new Error(`Error creating temporary user: ${userError.message}`);
          }
        }
      }

      // Verificar que tenemos un userId válido
      if (!finalUserId) {
        throw new Error('No valid user ID available for exam creation');
      }

      console.log('📊 Using user ID for exam:', finalUserId);

      // INICIAR TRANSACCIÓN AQUÍ (después de manejar el usuario)
      await client.query('BEGIN');
      transactionStarted = true;
      
      let certification;

      // Obtener información de la certificación
      if (typeof examConfig.provider === 'number' && typeof examConfig.certification === 'number') {
        console.log('📊 Looking up certification by IDs:', { 
          provider: examConfig.provider, 
          certification: examConfig.certification 
        });
        
        const certQuery = `
          SELECT 
            c.id, c.name, c.code, c.description, c.duration_minutes, 
            c.passing_score, c.total_questions,
            p.name as provider_name, p.description as provider_description
          FROM certifications c
          JOIN providers p ON c.provider_id = p.id
          WHERE p.id = $1 AND c.id = $2 AND c.is_active = true
        `;
        const certResult = await client.query(certQuery, [examConfig.provider, examConfig.certification]);
        
        if (certResult.rows.length === 0) {
          throw new Error(`No certification found for provider ID: ${examConfig.provider}, certification ID: ${examConfig.certification}`);
        }
        
        certification = certResult.rows[0];
        console.log('✅ Found certification:', certification.name);
      } else {
        throw new Error('Provider and certification must be numeric IDs');
      }

      // Configuraciones del examen
      const examTitle = `${certification.provider_name} ${certification.name} - ${examConfig.mode === 'practice' ? 'Práctica' : 'Examen Real'}`;
      const finalQuestionCount = certification.total_questions || 2;
      const finalTimeLimit = examConfig.timeLimit || certification.duration_minutes || 120;

      // Obtener preguntas aleatorias ANTES de insertar el examen
      console.log('🔍 Fetching questions with filters:', {
        provider: examConfig.provider,
        certification: examConfig.certification,
        count: finalQuestionCount
      });

      const questions = await QuestionService.getRandomQuestions(
        finalQuestionCount,
        {
          provider: examConfig.provider,
          certification: examConfig.certification,
          category: examConfig.category,
          difficulty: examConfig.difficulty
        }
      );

      if (questions.length === 0) {
        throw new Error(`No questions found matching the criteria for provider ID ${examConfig.provider}, certification ID ${examConfig.certification}`);
      }

      console.log(`✅ Found ${questions.length} questions for exam`);

      // 💾 CREAR EXAMEN EN BASE DE DATOS
      console.log('📝 Inserting exam into database...');
      
      const insertExamQuery = `
        INSERT INTO exams (
          user_id, session_id, certification_id, exam_mode, status,
          total_questions, time_limit_minutes, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *
      `;

      const examValues = [
        finalUserId,
        sessionId,
        certification.id,
        examConfig.mode || 'practice',
        'pending',
        questions.length,
        finalTimeLimit
      ];

      console.log('📤 Exam values:', {
        userId: finalUserId,
        sessionId: sessionId,
        certificationId: certification.id,
        mode: examConfig.mode || 'practice',
        status: 'pending',
        questionCount: questions.length,
        timeLimit: finalTimeLimit
      });

      const examResult = await client.query(insertExamQuery, examValues);
      const examRow = examResult.rows[0];
      const examId = examRow.id;

      console.log('✅ Exam created with ID:', examId);

      // Insertar las preguntas del examen
      console.log('📝 Inserting exam questions...');
      
      const insertQuestionsQuery = `
        INSERT INTO exam_questions (exam_id, question_id, question_order)
        VALUES ($1, $2, $3)
      `;

      // Randomizar preguntas si está configurado
      const orderedQuestions = examConfig.settings?.randomizeQuestions ? 
        questions.sort(() => 0.5 - Math.random()) : questions;

      for (let i = 0; i < orderedQuestions.length; i++) {
        await client.query(insertQuestionsQuery, [
          examId,
          orderedQuestions[i].id,
          i + 1
        ]);
      }

      console.log(`✅ Inserted ${orderedQuestions.length} questions`);

      // COMMIT TRANSACCIÓN
      await client.query('COMMIT');
      transactionStarted = false;
      console.log('✅ Transaction committed successfully');

      // 🎯 CREAR OBJETO EXAM
      const exam = new Exam({
        id: examId,
        userId: userId, // Mantener el userId original (null para anónimos)
        sessionId: sessionId,
        title: examTitle,
        provider: certification.provider_name,
        certification: certification.code,
        questions: orderedQuestions,
        timeLimit: finalTimeLimit,
        passingScore: certification.passing_score || 70,
        status: 'not_started',
        createdAt: examRow.created_at,
        updatedAt: examRow.updated_at,
        settings: {
          showExplanations: examConfig.mode === 'practice',
          randomizeQuestions: examConfig.settings?.randomizeQuestions !== false,
          randomizeAnswers: examConfig.settings?.randomizeAnswers === true,
          allowPause: examConfig.mode === 'practice',
          allowReview: examConfig.mode === 'practice',
          ...examConfig.settings
        }
      });

      logger.info('Exam created successfully:', {
        id: examId,
        title: examTitle,
        originalUserId: userId,
        finalUserId: finalUserId,
        sessionId: sessionId,
        questionCount: exam.questions.length,
        isTemporaryUser: !userId
      });

      return exam;
      
    } catch (error) {
      // MANEJO DE ERRORES MEJORADO
      console.error('❌ Error in createExam:', error);
      
      // Solo hacer rollback si la transacción fue iniciada
      if (transactionStarted) {
        try {
          console.log('🔄 Rolling back transaction...');
          await client.query('ROLLBACK');
          console.log('✅ Transaction rolled back successfully');
        } catch (rollbackError) {
          console.error('❌ Error during rollback:', rollbackError);
        }
      }
      
      logger.error('Error creating exam:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getExamForReview(examId, userId = null, sessionId = null) {
    try {
      const exam = await this.getExamById(examId, userId, sessionId);
      
      if (!exam) {
        return null;
      }

      // Verificar que el examen esté completado
      if (exam.status !== 'completed') {
        throw new Error('Only completed exams can be reviewed');
      }

      // Para revisión, asegurar que todas las preguntas tengan respuestas correctas
      const client = await this.pool.connect();
      
      try {
        // Obtener respuestas correctas para todas las preguntas del examen
        const correctAnswersQuery = `
          SELECT 
            q.id as question_id,
            array_agg(qo.order_index - 1 ORDER BY qo.order_index) as correct_indices
          FROM exam_questions eq
          JOIN questions q ON eq.question_id = q.id
          JOIN question_options qo ON q.id = qo.question_id
          WHERE eq.exam_id = $1 AND qo.is_correct = true
          GROUP BY q.id
        `;
        
        const correctAnswersResult = await client.query(correctAnswersQuery, [examId]);
        const correctAnswersMap = {};
        
        correctAnswersResult.rows.forEach(row => {
          correctAnswersMap[row.question_id] = row.correct_indices;
        });

        // Actualizar las preguntas del examen con respuestas correctas
        exam.questions = exam.questions.map(question => ({
          ...question,
          correctAnswers: correctAnswersMap[question.id] || []
        }));

        return exam;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      logger.error('Error getting exam for review:', error);
      throw error;
    }
  }

  async getExamById(id, userId = null, sessionId = null) {
    const client = await this.pool.connect();
    try {
      logger.debug('Looking for exam:', { id, userId, sessionId });

      // Consulta para obtener el examen con información de certificación
      const examQuery = `
        SELECT 
          e.*,
          c.name as certification_name,
          c.code as certification_code,
          c.passing_score,
          p.name as provider_name
        FROM exams e
        JOIN certifications c ON e.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        WHERE e.id = $1
          AND (
            ($2::INTEGER IS NOT NULL AND e.user_id = $2) OR
            ($3::TEXT IS NOT NULL AND e.session_id = $3)
          )
      `;

      const examResult = await client.query(examQuery, [id, userId, sessionId]);

      if (examResult.rows.length === 0) {
        logger.warn('Exam not found:', { id, userId, sessionId });
        return null;
      }

      const examRow = examResult.rows[0];

      // Obtener las preguntas del examen con sus opciones
      const questionsQuery = `
        SELECT 
          q.*,
          eq.question_order,
          eq.is_answered,
          eq.is_correct,
          eq.time_spent_seconds,
          qt.name as question_type,
          t.name as topic_name
        FROM exam_questions eq
        JOIN questions q ON eq.question_id = q.id
        JOIN question_types qt ON q.question_type_id = qt.id
        JOIN topics t ON q.topic_id = t.id
        WHERE eq.exam_id = $1
        ORDER BY eq.question_order
      `;

      const questionsResult = await client.query(questionsQuery, [id]);

      // Obtener opciones para cada pregunta
      const questions = [];
      for (const questionRow of questionsResult.rows) {
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
          provider: examRow.provider_name,
          questionType: questionRow.question_type,
          isMultipleChoice: questionRow.question_type === 'multiple_answer',
          expectedAnswers: questionRow.expected_answers_count,
          options: optionsResult.rows.map(opt => ({
            label: opt.option_label,
            text: opt.option_text
          })),
          correctAnswers: optionsResult.rows
            .filter(opt => opt.is_correct)
            .map((opt, index) => index),
          order: questionRow.question_order,
          isAnswered: questionRow.is_answered,
          isCorrect: questionRow.is_correct,
          timeSpent: questionRow.time_spent_seconds
        });
      }

      // Obtener respuestas del usuario
      const answersQuery = `
        SELECT 
          eq.question_id,
          array_agg(qo.order_index ORDER BY ua.id) as selected_options
        FROM exam_questions eq
        LEFT JOIN user_answers ua ON eq.id = ua.exam_question_id
        LEFT JOIN question_options qo ON ua.question_option_id = qo.id
        WHERE eq.exam_id = $1
        GROUP BY eq.question_id
      `;

      const answersResult = await client.query(answersQuery, [id]);
      const answers = {};

      answersResult.rows.forEach(row => {
        if (row.selected_options && row.selected_options[0] !== null) {
          const questionData = questions.find(q => q.id === row.question_id);
          if (questionData && questionData.isMultipleChoice) {
            answers[row.question_id] = row.selected_options;
          } else {
            answers[row.question_id] = row.selected_options[0];
          }
        }
      });

      // Crear objeto Exam
      const exam = new Exam({
        id: examRow.id,
        userId: examRow.user_id,
        sessionId: examRow.session_id,
        title: `${examRow.provider_name} ${examRow.certification_name} Exam`,
        provider: examRow.provider_name,
        certification: examRow.certification_code,
        questions: questions,
        answers: answers,
        timeLimit: examRow.time_limit_minutes,
        timeSpent: examRow.time_spent_minutes,
        status: this.mapStatusToClientFormat(examRow.status),
        score: examRow.percentage_score,
        passed: examRow.passing_status === 'passed',
        passingScore: examRow.passing_score,
        startedAt: examRow.started_at,
        completedAt: examRow.completed_at,
        createdAt: examRow.created_at,
        updatedAt: examRow.updated_at
      });

      logger.debug('Found exam:', { id, status: exam.status });
      return exam;

    } catch (error) {
      logger.error('Error getting exam by id:', error);
      return null;
    } finally {
      client.release();
    }
  }

  async getUserExams(userId, filters = {}) {
    const client = await this.pool.connect();
    try {
      let whereConditions = ['e.user_id = $1'];
      let queryParams = [userId];
      let paramIndex = 2;

      // Apply filters
      if (filters.status) {
        whereConditions.push(`e.status = $${paramIndex}`);
        queryParams.push(this.mapStatusToDbFormat(filters.status));
        paramIndex++;
      }

      if (filters.provider) {
        whereConditions.push(`p.name = $${paramIndex}`);
        queryParams.push(filters.provider);
        paramIndex++;
      }

      const query = `
        SELECT 
          e.*,
          c.name as certification_name,
          c.code as certification_code,
          p.name as provider_name
        FROM exams e
        JOIN certifications c ON e.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY e.created_at DESC
      `;

      const result = await client.query(query, queryParams);
      
      const exams = result.rows.map(row => new Exam({
        id: row.id,
        userId: row.user_id,
        title: `${row.provider_name} ${row.certification_name} Exam`,
        provider: row.provider_name,
        certification: row.certification_code,
        timeLimit: row.time_limit_minutes,
        timeSpent: row.time_spent_minutes,
        status: this.mapStatusToClientFormat(row.status),
        score: row.percentage_score,
        passed: row.passing_status === 'passed',
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        questions: [], // Summary view doesn't need full questions
        answers: {}
      }));

      return exams;
    } catch (error) {
      logger.error('Error getting user exams:', error);
      return [];
    } finally {
      client.release();
    }
  }

  async getSessionExams(sessionId, filters = {}) {
    const client = await this.pool.connect();
    try {
      let whereConditions = ['e.session_id = $1'];
      let queryParams = [sessionId];
      let paramIndex = 2;

      // Apply filters
      if (filters.status) {
        whereConditions.push(`e.status = $${paramIndex}`);
        queryParams.push(this.mapStatusToDbFormat(filters.status));
        paramIndex++;
      }

      if (filters.provider) {
        whereConditions.push(`p.name = $${paramIndex}`);
        queryParams.push(filters.provider);
        paramIndex++;
      }

      const query = `
        SELECT 
          e.*,
          c.name as certification_name,
          c.code as certification_code,
          p.name as provider_name
        FROM exams e
        JOIN certifications c ON e.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY e.created_at DESC
      `;

      const result = await client.query(query, queryParams);
      
      const exams = result.rows.map(row => new Exam({
        id: row.id,
        sessionId: row.session_id,
        title: `${row.provider_name} ${row.certification_name} Exam`,
        provider: row.provider_name,
        certification: row.certification_code,
        timeLimit: row.time_limit_minutes,
        timeSpent: row.time_spent_minutes,
        status: this.mapStatusToClientFormat(row.status),
        score: row.percentage_score,
        passed: row.passing_status === 'passed',
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        questions: [], // Summary view doesn't need full questions
        answers: {}
      }));

      return exams;
    } catch (error) {
      logger.error('Error getting session exams:', error);
      return [];
    } finally {
      client.release();
    }
  }

  async startExam(examId, userId = null, sessionId = null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      logger.info('Attempting to start exam:', { examId, userId, sessionId });

      const exam = await this.getExamById(examId, userId, sessionId);
      
      if (!exam) {
        logger.error('Exam not found when starting:', { examId, userId, sessionId });
        throw new Error('Exam not found');
      }

      // Verificar autorización
      if (!exam.belongsTo(userId, sessionId)) {
        logger.error('Unauthorized access attempt:', { examId, userId, sessionId });
        throw new Error('Unauthorized to access this exam');
      }

      if (exam.status !== 'not_started') {
        logger.warn('Attempt to start exam that is not in not_started status:', {
          examId,
          currentStatus: exam.status
        });
        throw new Error(`Exam already started or completed (status: ${exam.status})`);
      }

      // Actualizar estado del examen
      const updateQuery = `
        UPDATE exams 
        SET status = 'active', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;

      await client.query(updateQuery, [examId]);
      await client.query('COMMIT');

      // Obtener el examen actualizado
      const updatedExam = await this.getExamById(examId, userId, sessionId);
      
      logger.info('Exam started successfully:', {
        examId,
        userId,
        sessionId,
        startedAt: updatedExam.startedAt
      });

      return updatedExam;
    } catch (error) {
      await client.query('ROLLBACK');
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

      const exam = await this.getExamById(examId, userId, sessionId);
      
      if (!exam) {
        throw new Error('Exam not found');
      }

      // Verificar autorización
      if (!exam.belongsTo(userId, sessionId)) {
        throw new Error('Unauthorized to access this exam');
      }

      if (exam.status !== 'in_progress') {
        throw new Error('Exam is not in progress');
      }

      // Obtener exam_question_id
      const examQuestionQuery = `
        SELECT id FROM exam_questions 
        WHERE exam_id = $1 AND question_id = $2
      `;
      const examQuestionResult = await client.query(examQuestionQuery, [examId, questionId]);
      
      if (examQuestionResult.rows.length === 0) {
        throw new Error('Question not found in exam');
      }

      const examQuestionId = examQuestionResult.rows[0].id;

      // Eliminar respuestas anteriores para esta pregunta
      const deleteAnswersQuery = `
        DELETE FROM user_answers WHERE exam_question_id = $1
      `;
      await client.query(deleteAnswersQuery, [examQuestionId]);

      // Obtener opciones de la pregunta
      const optionsQuery = `
        SELECT id, order_index, is_correct 
        FROM question_options 
        WHERE question_id = $1 
        ORDER BY order_index
      `;
      const optionsResult = await client.query(optionsQuery, [questionId]);
      const options = optionsResult.rows;

      // Insertar nuevas respuestas
      const answers = Array.isArray(answer) ? answer : [answer];
      let isCorrect = true;
      
      for (const answerIndex of answers) {
        const option = options[answerIndex];
        if (!option) {
          throw new Error(`Invalid answer index: ${answerIndex}`);
        }

        const insertAnswerQuery = `
          INSERT INTO user_answers (exam_question_id, question_option_id, is_correct)
          VALUES ($1, $2, $3)
        `;
        await client.query(insertAnswerQuery, [examQuestionId, option.id, option.is_correct]);
        
        if (!option.is_correct) {
          isCorrect = false;
        }
      }

      // Verificar si es una respuesta múltiple correcta completa
      if (Array.isArray(answer)) {
        const correctOptions = options.filter(opt => opt.is_correct);
        isCorrect = answers.length === correctOptions.length && 
                   answers.every(idx => options[idx].is_correct);
      }

      // Actualizar exam_questions
      const updateExamQuestionQuery = `
        UPDATE exam_questions 
        SET is_answered = true, is_correct = $1, answered_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `;
      await client.query(updateExamQuestionQuery, [isCorrect, examQuestionId]);

      // Actualizar timestamp del examen
      const updateExamQuery = `
        UPDATE exams SET updated_at = CURRENT_TIMESTAMP WHERE id = $1
      `;
      await client.query(updateExamQuery, [examId]);

      await client.query('COMMIT');
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error submitting answer:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeExam(examId, userId = null, sessionId = null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const exam = await this.getExamById(examId, userId, sessionId);
      
      if (!exam) {
        throw new Error('Exam not found');
      }

      // Verificar autorización
      if (!exam.belongsTo(userId, sessionId)) {
        throw new Error('Unauthorized to access this exam');
      }

      if (exam.status !== 'in_progress') {
        throw new Error('Exam is not in progress');
      }

      // Calcular estadísticas del examen
      const statsQuery = `
        SELECT 
          COUNT(*) as total_questions,
          COUNT(CASE WHEN eq.is_answered THEN 1 END) as answered_questions,
          COUNT(CASE WHEN eq.is_correct THEN 1 END) as correct_answers,
          SUM(eq.time_spent_seconds) as total_time_seconds
        FROM exam_questions eq
        WHERE eq.exam_id = $1
      `;
      const statsResult = await client.query(statsQuery, [examId]);
      const stats = statsResult.rows[0];

      const percentageScore = stats.total_questions > 0 ? 
        (stats.correct_answers / stats.total_questions) * 100 : 0;

      // Obtener passing score de la certificación
      const passingScoreQuery = `
        SELECT c.passing_score 
        FROM exams e 
        JOIN certifications c ON e.certification_id = c.id 
        WHERE e.id = $1
      `;
      const passingScoreResult = await client.query(passingScoreQuery, [examId]);
      const passingScore = passingScoreResult.rows[0]?.passing_score || 70;

      const passed = percentageScore >= passingScore;
      const timeSpentMinutes = Math.round((stats.total_time_seconds || 0) / 60);

      // Actualizar el examen
      const updateExamQuery = `
        UPDATE exams 
        SET 
          status = 'completed',
          completed_at = CURRENT_TIMESTAMP,
          score = $2,
          percentage_score = $3,
          passing_status = $4,
          correct_answers = $5,
          incorrect_answers = $6,
          time_spent_minutes = $7,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;

      await client.query(updateExamQuery, [
        examId,
        percentageScore,
        percentageScore,
        passed ? 'passed' : 'failed',
        stats.correct_answers,
        stats.total_questions - stats.correct_answers,
        timeSpentMinutes
      ]);

      await client.query('COMMIT');

      // Actualizar estadísticas del usuario si está autenticado
      if (userId) {
        try {
          const results = {
            score: percentageScore,
            passed: passed,
            totalQuestions: stats.total_questions,
            correctAnswers: stats.correct_answers,
            timeSpent: timeSpentMinutes
          };
          await UserService.updateUserStats(userId, results);

          // Actualizar estadísticas de preguntas
          const questionsQuery = `
            SELECT q.id, eq.is_correct, $2 as time_spent
            FROM exam_questions eq
            JOIN questions q ON eq.question_id = q.id
            WHERE eq.exam_id = $1 AND eq.is_answered = true
          `;
          const questionsResult = await client.query(questionsQuery, [examId, timeSpentMinutes]);

          for (const questionRow of questionsResult.rows) {
            await QuestionService.updateQuestionStats(
              questionRow.id, 
              questionRow.is_correct, 
              questionRow.time_spent
            );
          }
        } catch (error) {
          logger.error('Error updating user stats:', error);
          // No lanzar error, el examen ya está completado
        }
      }

      return await this.getExamById(examId, userId, sessionId);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error completing exam:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteExam(id, userId = null, sessionId = null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Verificar que el examen existe y pertenece al usuario/sesión
      const exam = await this.getExamById(id, userId, sessionId);
      
      if (!exam) {
        throw new Error('Exam not found');
      }

      if (!exam.belongsTo(userId, sessionId)) {
        throw new Error('Unauthorized to access this exam');
      }

      // Eliminar el examen (las tablas relacionadas se eliminan por CASCADE)
      const deleteQuery = `DELETE FROM exams WHERE id = $1`;
      await client.query(deleteQuery, [id]);

      await client.query('COMMIT');
      logger.info('Exam deleted successfully:', { id, userId, sessionId });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error deleting exam:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getExamResults(examId, userId = null, sessionId = null) {
    try {
      const exam = await this.getExamById(examId, userId, sessionId);
      
      if (!exam) {
        throw new Error('Exam not found');
      }

      // Verificar autorización
      if (!exam.belongsTo(userId, sessionId)) {
        throw new Error('Unauthorized to access this exam');
      }

      if (exam.status !== 'completed') {
        throw new Error('Exam not completed yet');
      }

      return exam.getResults();
    } catch (error) {
      logger.error('Error getting exam results:', error);
      throw error;
    }
  }

  // Métodos auxiliares para mapear estados
  mapStatusToClientFormat(dbStatus) {
    const statusMap = {
      'pending': 'not_started',
      'active': 'in_progress',
      'paused': 'paused',
      'completed': 'completed',
      'cancelled': 'cancelled'
    };
    return statusMap[dbStatus] || dbStatus;
  }

  mapStatusToDbFormat(clientStatus) {
    const statusMap = {
      'not_started': 'pending',
      'in_progress': 'active',
      'paused': 'paused',
      'completed': 'completed',
      'cancelled': 'cancelled'
    };
    return statusMap[clientStatus] || clientStatus;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = new ExamService();