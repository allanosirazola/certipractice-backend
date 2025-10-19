// src/services/questionService.js - UPDATED FOR NEW POSTGRESQL SCHEMA
const { Pool } = require('pg');
const Question = require('../models/Question');
const logger = require('../utils/logger');

class QuestionService {
  constructor() {
    this.pool = new Pool({
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'exam_system',
      password: process.env.DB_PASSWORD || 'your_password',
      port: process.env.DB_PORT || 5432,
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      min: parseInt(process.env.DB_POOL_MIN) || 0,
      idle: parseInt(process.env.DB_POOL_IDLE) || 10000,
      acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
    });
  }

  async loadQuestions() {
    try {
      const client = await this.pool.connect();
      const result = await client.query(`
        SELECT 
          q.id,
          q.external_id,
          q.question_text as text,
          q.explanation,
          q.difficulty_level as difficulty,
          q.expected_answers_count,
          q.points,
          q.is_active,
          q.created_at,
          q.updated_at,
          t.name as topic_name,
          c.name as certification_name,
          c.code as certification_code,
          p.name as provider_name,
          qt.name as question_type,
          qt.display_name as question_type_display,
          COALESCE(
            json_agg(
              json_build_object(
                'label', qo.option_label,
                'text', qo.option_text,
                'explanation', qo.explanation
              ) ORDER BY qo.order_index
            ) FILTER (WHERE qo.id IS NOT NULL), 
            '[]'::json
          ) as options,
          COALESCE(
            array_agg(qo.order_index ORDER BY qo.order_index) FILTER (WHERE qo.is_correct = true),
            ARRAY[]::integer[]
          ) as correct_answer_indices
        FROM questions q
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        JOIN question_types qt ON q.question_type_id = qt.id
        LEFT JOIN question_options qo ON q.id = qo.question_id
        WHERE q.is_active = true AND q.review_status = 'approved'
        GROUP BY q.id, q.external_id, q.question_text, q.explanation, q.difficulty_level,
                 q.expected_answers_count, q.points, q.is_active, q.created_at, q.updated_at,
                 t.name, c.name, c.code, p.name, qt.name, qt.display_name
      `);
      client.release();
      
      return result.rows.map(row => this.mapRowToQuestion(row));
    } catch (error) {
      logger.error('Error loading questions from database:', error);
      return [];
    }
  }

  mapRowToQuestion(row) {
    // Convert correct answer indices to 0-based for frontend
    const correctAnswers = (row.correct_answer_indices || []).map(index => index - 1);
    
    return new Question({
      id: row.id,
      externalId: row.external_id,
      text: row.text,
      options: row.options || [],
      correctAnswers: correctAnswers,
      explanation: row.explanation,
      category: row.topic_name,
      provider: row.provider_name,
      certification: row.certification_name,
      certificationCode: row.certification_code,
      difficulty: row.difficulty,
      questionType: row.question_type,
      questionTypeDisplay: row.question_type_display,
      expectedAnswers: row.expected_answers_count || 1,
      points: parseFloat(row.points) || 1.0,
      isMultipleChoice: row.expected_answers_count > 1,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      stats: {
        totalAttempts: 0,
        correctAttempts: 0,
        averageTime: 0
      }
    });
  }

  async getQuestions(filters = {}) {
    try {
      let whereConditions = ['q.is_active = true', "q.review_status = 'approved'"];
      let params = [];

      // Apply filters
      if (filters.provider) {
        params.push(filters.provider.toLowerCase());
        whereConditions.push(`LOWER(p.name) = $${params.length}`);
      }

      if (filters.certification) {
        params.push(filters.certification.toLowerCase());
        whereConditions.push(`(LOWER(c.name) = $${params.length} OR LOWER(c.code) = $${params.length})`);
      }

      if (filters.category || filters.topic) {
        const topic = filters.category || filters.topic;
        params.push(topic.toLowerCase());
        whereConditions.push(`LOWER(t.name) = $${params.length}`);
      }

      if (filters.difficulty) {
        params.push(filters.difficulty.toLowerCase());
        whereConditions.push(`q.difficulty_level = $${params.length}::difficulty_level`);
      }

      if (filters.questionType) {
        params.push(filters.questionType.toLowerCase());
        whereConditions.push(`LOWER(qt.name) = $${params.length}`);
      }

      const whereClause = whereConditions.join(' AND ');

      // Count total for pagination
      const countQuery = `
        SELECT COUNT(*) 
        FROM questions q
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        JOIN question_types qt ON q.question_type_id = qt.id
        WHERE ${whereClause}
      `;
      
      // Main query with pagination
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit) || 20;
      const offset = (page - 1) * limit;
      
      params.push(limit);
      const limitParam = params.length;
      params.push(offset);
      const offsetParam = params.length;
      
      const mainQuery = `
        SELECT 
          q.id,
          q.external_id,
          q.question_text as text,
          q.explanation,
          q.difficulty_level as difficulty,
          q.expected_answers_count,
          q.points,
          q.is_active,
          q.created_at,
          q.updated_at,
          t.name as topic_name,
          c.name as certification_name,
          c.code as certification_code,
          p.name as provider_name,
          qt.name as question_type,
          qt.display_name as question_type_display,
          COALESCE(
            json_agg(
              json_build_object(
                'label', qo.option_label,
                'text', qo.option_text,
                'explanation', qo.explanation
              ) ORDER BY qo.order_index
            ) FILTER (WHERE qo.id IS NOT NULL), 
            '[]'::json
          ) as options,
          COALESCE(
            array_agg(qo.order_index ORDER BY qo.order_index) FILTER (WHERE qo.is_correct = true),
            ARRAY[]::integer[]
          ) as correct_answer_indices
        FROM questions q
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        JOIN question_types qt ON q.question_type_id = qt.id
        LEFT JOIN question_options qo ON q.id = qo.question_id
        WHERE ${whereClause}
        GROUP BY q.id, q.external_id, q.question_text, q.explanation, q.difficulty_level,
                 q.expected_answers_count, q.points, q.is_active, q.created_at, q.updated_at,
                 t.name, c.name, c.code, p.name, qt.name, qt.display_name
        ORDER BY q.created_at DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}
      `;

      const client = await this.pool.connect();
      
      // Get total count
      const countParams = params.slice(0, params.length - 2);
      const countResult = await client.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count);
      
      // Get questions
      const result = await client.query(mainQuery, params);
      client.release();

      const questions = result.rows.map(row => this.mapRowToQuestion(row));

      return {
        questions,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error getting questions from database:', error);
      return {
        questions: [],
        pagination: { total: 0, page: 1, limit: 20, pages: 0 }
      };
    }
  }

  async getQuestionById(id, includeStats = false) {
    try {
      const client = await this.pool.connect();
      
      let query = `
        SELECT 
          q.id,
          q.external_id,
          q.question_text as text,
          q.explanation,
          q.difficulty_level as difficulty,
          q.expected_answers_count,
          q.points,
          q.is_active,
          q.created_at,
          q.updated_at,
          t.name as topic_name,
          c.name as certification_name,
          c.code as certification_code,
          p.name as provider_name,
          qt.name as question_type,
          qt.display_name as question_type_display,
          COALESCE(
            json_agg(
              json_build_object(
                'label', qo.option_label,
                'text', qo.option_text,
                'explanation', qo.explanation
              ) ORDER BY qo.order_index
            ) FILTER (WHERE qo.id IS NOT NULL), 
            '[]'::json
          ) as options,
          COALESCE(
            array_agg(qo.order_index ORDER BY qo.order_index) FILTER (WHERE qo.is_correct = true),
            ARRAY[]::integer[]
          ) as correct_answer_indices
      `;

      if (includeStats) {
        query += `,
          COALESCE(qs.total_attempts, 0) as total_attempts,
          COALESCE(qs.correct_attempts, 0) as correct_attempts,
          COALESCE(qs.success_rate, 0) as success_rate,
          COALESCE(qs.average_time_seconds, 0) as average_time_seconds`;
      }

      query += `
        FROM questions q
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        JOIN question_types qt ON q.question_type_id = qt.id
        LEFT JOIN question_options qo ON q.id = qo.question_id`;

      if (includeStats) {
        query += `
        LEFT JOIN question_statistics qs ON q.id = qs.question_id`;
      }

      query += `
        WHERE q.id = $1
        GROUP BY q.id, q.external_id, q.question_text, q.explanation, q.difficulty_level,
                 q.expected_answers_count, q.points, q.is_active, q.created_at, q.updated_at,
                 t.name, c.name, c.code, p.name, qt.name, qt.display_name`;

      if (includeStats) {
        query += `, qs.total_attempts, qs.correct_attempts, qs.success_rate, qs.average_time_seconds`;
      }

      const result = await client.query(query, [id]);
      client.release();
      
      if (result.rows.length === 0) return null;
      
      const row = result.rows[0];

      // Convertir índices de 1-based (DB) a 0-based (frontend)
      const correctAnswers = (row.correct_answer_indices || []).map(index => index - 1);

      // Crear el objeto con índices convertidos
      const questionData = new Question({
        id: row.id,
        externalId: row.external_id,
        text: row.text,
        options: row.options || [],
        correctAnswers: correctAnswers, // ✅ Índices ya convertidos
        explanation: row.explanation,
        category: row.topic_name,
        provider: row.provider_name,
        certification: row.certification_name,
        certificationCode: row.certification_code,
        difficulty: row.difficulty,
        questionType: row.question_type,
        questionTypeDisplay: row.question_type_display,
        expectedAnswers: row.expected_answers_count || 1,
        points: parseFloat(row.points) || 1.0,
        isMultipleChoice: row.expected_answers_count > 1,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });

      if (includeStats && result.rows[0].total_attempts !== undefined) {
        questionData.stats = {
          totalAttempts: result.rows[0].total_attempts,
          correctAttempts: result.rows[0].correct_attempts,
          averageTime: result.rows[0].average_time_seconds,
          successRate: result.rows[0].success_rate
        };
      }

      return questionData;
    } catch (error) {
      logger.error('Error getting question by id:', error);
      return null;
    }
  }

async getRandomQuestions(count, filters = {}) {
    try {
      let whereConditions = ['q.is_active = true', "q.review_status = 'approved'"];
      let params = [];

      console.log('🔍 getRandomQuestions called with filters:', filters);

      // CORREGIDO: Apply filters using IDs instead of names
      if (filters.provider) {
        // Check if it's a number (ID) or string (name)
        if (typeof filters.provider === 'number' || !isNaN(filters.provider)) {
          params.push(parseInt(filters.provider));
          whereConditions.push(`p.id = $${params.length}`);
          console.log('📌 Added provider ID filter:', filters.provider);
        } else {
          params.push(filters.provider.toLowerCase());
          whereConditions.push(`LOWER(p.name) = $${params.length}`);
          console.log('📌 Added provider name filter:', filters.provider);
        }
      }

      if (filters.certification) {
        // Check if it's a number (ID) or string (name/code)
        if (typeof filters.certification === 'number' || !isNaN(filters.certification)) {
          params.push(parseInt(filters.certification));
          whereConditions.push(`c.id = $${params.length}`);
          console.log('📌 Added certification ID filter:', filters.certification);
        } else {
          params.push(filters.certification.toLowerCase());
          whereConditions.push(`(LOWER(c.name) = $${params.length} OR LOWER(c.code) = $${params.length})`);
          console.log('📌 Added certification name/code filter:', filters.certification);
        }
      }

      if (filters.category || filters.topic) {
        const topic = filters.category || filters.topic;
        // Check if it's a number (ID) or string (name)
        if (typeof topic === 'number' || !isNaN(topic)) {
          params.push(parseInt(topic));
          whereConditions.push(`t.id = $${params.length}`);
          console.log('📌 Added topic ID filter:', topic);
        } else {
          params.push(topic.toLowerCase());
          whereConditions.push(`LOWER(t.name) = $${params.length}`);
          console.log('📌 Added topic name filter:', topic);
        }
      }
      const whereClause = whereConditions.join(' AND ');
      
      params.push(count);
      const countParam = params.length;
      
      console.log('🔍 Final SQL WHERE clause:', whereClause);
      console.log('🔍 SQL parameters:', params);
      
      const query = `
        SELECT 
          q.id,
          q.external_id,
          q.question_text as text,
          q.explanation,
          q.difficulty_level as difficulty,
          q.expected_answers_count,
          q.points,
          q.is_active,
          q.created_at,
          q.updated_at,
          t.name as topic_name,
          c.name as certification_name,
          c.code as certification_code,
          p.name as provider_name,
          qt.name as question_type,
          qt.display_name as question_type_display,
          COALESCE(
            json_agg(
              json_build_object(
                'label', qo.option_label,
                'text', qo.option_text,
                'explanation', qo.explanation
              ) ORDER BY qo.order_index
            ) FILTER (WHERE qo.id IS NOT NULL), 
            '[]'::json
          ) as options,
          COALESCE(
            array_agg(qo.order_index ORDER BY qo.order_index) FILTER (WHERE qo.is_correct = true),
            ARRAY[]::integer[]
          ) as correct_answer_indices
        FROM questions q
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        JOIN question_types qt ON q.question_type_id = qt.id
        LEFT JOIN question_options qo ON q.id = qo.question_id
        WHERE ${whereClause}
        GROUP BY q.id, q.external_id, q.question_text, q.explanation, q.difficulty_level,
                 q.expected_answers_count, q.points, q.is_active, q.created_at, q.updated_at,
                 t.name, c.name, c.code, p.name, qt.name, qt.display_name
        ORDER BY RANDOM()
        LIMIT $${countParam}
      `;

      const client = await this.pool.connect();
      const result = await client.query(query, params);
      client.release();

      console.log(`✅ Found ${result.rows.length} questions for filters:`, filters);

      if (result.rows.length === 0) {
        logger.warn('No questions found for filters:', filters);
        
        // DEBUGGING: Let's check what's available
        const debugClient = await this.pool.connect();
        try {
          // Check if provider exists
          if (filters.provider) {
            const providerCheck = await debugClient.query('SELECT id, name FROM providers WHERE id = $1', [parseInt(filters.provider)]);
            console.log('🔍 Provider check:', providerCheck.rows);
          }
          
          // Check if certification exists
          if (filters.certification) {
            const certCheck = await debugClient.query('SELECT id, name, code FROM certifications WHERE id = $1', [parseInt(filters.certification)]);
            console.log('🔍 Certification check:', certCheck.rows);
          }
          
          // Check total questions available
          const totalCheck = await debugClient.query(`
            SELECT COUNT(*) as total, p.name as provider_name, c.name as cert_name 
            FROM questions q
            JOIN topics t ON q.topic_id = t.id
            JOIN certifications c ON t.certification_id = c.id
            JOIN providers p ON c.provider_id = p.id
            WHERE q.is_active = true AND q.review_status = 'approved'
            GROUP BY p.name, c.name
          `);
          console.log('🔍 Available questions by provider/cert:', totalCheck.rows);
          
        } finally {
          debugClient.release();
        }
        
        return [];
      }

      return result.rows.map(row => this.mapRowToQuestion(row));
    } catch (error) {
      logger.error('Error getting random questions:', error);
      console.error('❌ SQL Error details:', error);
      return [];
    }
  }
  async getProviders() {
    try {
      const client = await this.pool.connect();
      
      // Get all active providers with optional counts
      const result = await client.query(`
        SELECT 
          p.id,
          p.name, 
          p.description, 
          p.website_url, 
          p.logo_url,
          p.created_at,
          COALESCE(cert_counts.certification_count, 0) as certification_count,
          COALESCE(question_counts.question_count, 0) as question_count
        FROM providers p
        LEFT JOIN (
          SELECT 
            provider_id,
            COUNT(*) as certification_count
          FROM certifications 
          WHERE is_active = true
          GROUP BY provider_id
        ) cert_counts ON p.id = cert_counts.provider_id
        LEFT JOIN (
          SELECT 
            p2.id as provider_id,
            COUNT(DISTINCT q.id) as question_count
          FROM providers p2
          LEFT JOIN certifications c ON p2.id = c.provider_id
          LEFT JOIN topics t ON c.id = t.certification_id
          LEFT JOIN questions q ON t.id = q.topic_id
          WHERE c.is_active = true 
            AND t.is_active = true 
            AND q.is_active = true
            AND q.review_status = 'approved'
          GROUP BY p2.id
        ) question_counts ON p.id = question_counts.provider_id
        WHERE p.is_active = true
        ORDER BY p.name
      `);
      client.release();
      
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        website_url: row.website_url,
        logo_url: row.logo_url,
        certification_count: parseInt(row.certification_count) || 0,
        question_count: parseInt(row.question_count) || 0,
        created_at: row.created_at
      }));
    } catch (error) {
      logger.error('Error getting providers:', error);
      return [];
    }
  }

  async getCertifications(provider) {
    try {
      const client = await this.pool.connect();
      let query = `
        SELECT DISTINCT 
          c.id,
          c.name, 
          c.code, 
          c.description, 
          c.difficulty_level, 
          c.duration_minutes, 
          c.passing_score, 
          c.total_questions,
          p.name as provider_name,
          COUNT(DISTINCT q.id) as available_questions
        FROM certifications c
        JOIN providers p ON c.provider_id = p.id
        JOIN topics t ON c.id = t.certification_id
        JOIN questions q ON t.id = q.topic_id
        WHERE c.is_active = true 
          AND t.is_active = true 
          AND q.is_active = true
          AND q.review_status = 'approved'
      `;
      let params = [];
      
      if (provider) {
        query += ' AND LOWER(p.name) = $1';
        params.push(provider.toLowerCase());
      }
      
      query += ` 
        GROUP BY c.id, c.name, c.code, c.description, c.difficulty_level, 
                 c.duration_minutes, c.passing_score, c.total_questions, p.name
        ORDER BY c.name`;
      
      const result = await client.query(query, params);
      client.release();
      
      return result.rows;
    } catch (error) {
      logger.error('Error getting certifications:', error);
      return [];
    }
  }

  async getCategories(certification) {
    try {
      const client = await this.pool.connect();
      let query = `
        SELECT DISTINCT 
          t.id,
          t.name, 
          t.description, 
          t.weight_percentage,
          c.name as certification_name,
          c.code as certification_code,
          COUNT(DISTINCT q.id) as question_count
        FROM topics t
        JOIN certifications c ON t.certification_id = c.id
        JOIN questions q ON t.id = q.topic_id
        WHERE t.is_active = true 
          AND q.is_active = true
          AND q.review_status = 'approved'
      `;
      let params = [];
      
      if (certification) {
        query += ' AND (LOWER(c.name) = $1 OR LOWER(c.code) = $1)';
        params.push(certification.toLowerCase());
      }
      
      query += `
        GROUP BY t.id, t.name, t.description, t.weight_percentage, c.name, c.code
        ORDER BY t.name`;
      
      const result = await client.query(query, params);
      client.release();
      
      return result.rows;
    } catch (error) {
      logger.error('Error getting categories:', error);
      return [];
    }
  }

  async getQuestionTypeStats() {
    try {
      const client = await this.pool.connect();
      const result = await client.query(`
        SELECT 
          COUNT(*) as total_questions,
          COUNT(CASE WHEN qt.name = 'multiple_answer' THEN 1 END) as multiple_choice_questions,
          COUNT(CASE WHEN qt.name = 'multiple_choice' THEN 1 END) as single_choice_questions,
          COUNT(CASE WHEN qt.name = 'true_false' THEN 1 END) as true_false_questions,
          AVG(q.expected_answers_count) as avg_expected_answers,
          COUNT(CASE WHEN q.difficulty_level = 'easy' THEN 1 END) as easy_questions,
          COUNT(CASE WHEN q.difficulty_level = 'medium' THEN 1 END) as medium_questions,
          COUNT(CASE WHEN q.difficulty_level = 'hard' THEN 1 END) as hard_questions,
          COUNT(CASE WHEN q.difficulty_level = 'expert' THEN 1 END) as expert_questions,
          AVG(q.points) as avg_points
        FROM questions q
        JOIN question_types qt ON q.question_type_id = qt.id
        WHERE q.is_active = true AND q.review_status = 'approved'
      `);
      client.release();
      
      const stats = result.rows[0];
      return {
        totalQuestions: parseInt(stats.total_questions),
        multipleChoiceQuestions: parseInt(stats.multiple_choice_questions),
        singleChoiceQuestions: parseInt(stats.single_choice_questions),
        trueFalseQuestions: parseInt(stats.true_false_questions),
        averageExpectedAnswers: parseFloat(stats.avg_expected_answers) || 1,
        averagePoints: parseFloat(stats.avg_points) || 1,
        difficultyBreakdown: {
          easy: parseInt(stats.easy_questions),
          medium: parseInt(stats.medium_questions),
          hard: parseInt(stats.hard_questions),
          expert: parseInt(stats.expert_questions)
        }
      };
    } catch (error) {
      logger.error('Error getting question type stats:', error);
      return {
        totalQuestions: 0,
        multipleChoiceQuestions: 0,
        singleChoiceQuestions: 0,
        trueFalseQuestions: 0,
        averageExpectedAnswers: 1,
        averagePoints: 1,
        difficultyBreakdown: { easy: 0, medium: 0, hard: 0, expert: 0 }
      };
    }
  }

  async updateQuestionStats(questionId, isCorrect, timeSpent) {
    try {
      const client = await this.pool.connect();
      
      await client.query(`
        INSERT INTO question_statistics (question_id, total_attempts, correct_attempts, average_time_seconds)
        VALUES ($1, 1, $2, $3)
        ON CONFLICT (question_id)
        DO UPDATE SET
          total_attempts = question_statistics.total_attempts + 1,
          correct_attempts = question_statistics.correct_attempts + $2,
          average_time_seconds = (
            (question_statistics.average_time_seconds * question_statistics.total_attempts + $3) / 
            (question_statistics.total_attempts + 1)
          ),
          success_rate = (
            (question_statistics.correct_attempts + $2)::decimal / 
            (question_statistics.total_attempts + 1) * 100
          ),
          last_updated = CURRENT_TIMESTAMP
      `, [questionId, isCorrect ? 1 : 0, timeSpent || 0]);
      
      client.release();
    } catch (error) {
      logger.error('Error updating question stats:', error);
    }
  }

  // Additional utility methods
  async getQuestionsByTopic(topicId) {
    try {
      const client = await this.pool.connect();
      const result = await client.query(`
        SELECT 
          q.id,
          q.question_text as text,
          q.difficulty_level as difficulty,
          q.expected_answers_count,
          COUNT(qo.id) as option_count
        FROM questions q
        LEFT JOIN question_options qo ON q.id = qo.question_id
        WHERE q.topic_id = $1 AND q.is_active = true AND q.review_status = 'approved'
        GROUP BY q.id, q.question_text, q.difficulty_level, q.expected_answers_count
        ORDER BY q.created_at
      `, [topicId]);
      client.release();
      
      return result.rows;
    } catch (error) {
      logger.error('Error getting questions by topic:', error);
      return [];
    }
  }

  async getQuestionStatistics(questionId) {
    try {
      const client = await this.pool.connect();
      const result = await client.query(`
        SELECT 
          total_attempts,
          correct_attempts,
          success_rate,
          average_time_seconds,
          last_updated
        FROM question_statistics
        WHERE question_id = $1
      `, [questionId]);
      client.release();
      
      return result.rows[0] || {
        total_attempts: 0,
        correct_attempts: 0,
        success_rate: 0,
        average_time_seconds: 0,
        last_updated: null
      };
    } catch (error) {
      logger.error('Error getting question statistics:', error);
      return null;
    }
  }

  // Admin methods for question management
  async createQuestion(questionData) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get or create topic
      const topicResult = await client.query(
        'SELECT id FROM topics WHERE name = $1 AND certification_id = (SELECT id FROM certifications WHERE code = $2)',
        [questionData.category, questionData.certificationCode]
      );
      
      if (topicResult.rows.length === 0) {
        throw new Error(`Topic ${questionData.category} not found for certification ${questionData.certificationCode}`);
      }
      
      const topicId = topicResult.rows[0].id;
      
      // Get question type
      const typeResult = await client.query(
        'SELECT id FROM question_types WHERE name = $1',
        [questionData.questionType]
      );
      
      if (typeResult.rows.length === 0) {
        throw new Error(`Question type ${questionData.questionType} not found`);
      }
      
      const questionTypeId = typeResult.rows[0].id;
      
      // Insert question
      const questionResult = await client.query(`
        INSERT INTO questions (
          external_id, topic_id, question_type_id, question_text, explanation,
          difficulty_level, expected_answers_count, points, review_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [
        questionData.externalId,
        topicId,
        questionTypeId,
        questionData.text,
        questionData.explanation,
        questionData.difficulty,
        questionData.expectedAnswers,
        questionData.points,
        'pending'
      ]);
      
      const questionId = questionResult.rows[0].id;
      
      // Insert options
      if (questionData.options && questionData.options.length > 0) {
        for (let i = 0; i < questionData.options.length; i++) {
          const option = questionData.options[i];
          const isCorrect = questionData.correctAnswers.includes(i);
          
          await client.query(`
            INSERT INTO question_options (
              question_id, option_label, option_text, is_correct, order_index, explanation
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            questionId,
            option.label || String.fromCharCode(65 + i), // A, B, C, D...
            option.text,
            isCorrect,
            i + 1, // 1-based indexing in DB
            option.explanation
          ]);
        }
      }
      
      await client.query('COMMIT');
      
      // Return the created question
      return await this.getQuestionById(questionId);
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating question:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Method to create sample data for testing
  async createSampleData() {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check if sample data already exists
      const existingData = await client.query('SELECT COUNT(*) FROM certifications');
      if (parseInt(existingData.rows[0].count) > 0) {
        logger.info('Sample data already exists, skipping creation');
        await client.query('ROLLBACK');
        return { message: 'Sample data already exists' };
      }
      
      // Create sample certifications for Google provider
      const googleProvider = await client.query('SELECT id FROM providers WHERE name = $1', ['Google']);
      if (googleProvider.rows.length === 0) {
        throw new Error('Google provider not found');
      }
      
      const providerId = googleProvider.rows[0].id;
      
      // Insert Google Cloud certifications
      const certifications = [
        {
          name: 'Google Cloud Associate Cloud Engineer',
          code: 'ACE',
          description: 'Entry-level certification for Google Cloud Platform',
          difficulty: 'medium',
          duration: 120,
          passing_score: 70,
          total_questions: 50
        },
        {
          name: 'Google Cloud Professional Cloud Architect',
          code: 'PCA',
          description: 'Professional-level certification for cloud architecture',
          difficulty: 'hard',
          duration: 120,
          passing_score: 75,
          total_questions: 50
        }
      ];
      
      const certIds = [];
      for (const cert of certifications) {
        const result = await client.query(`
          INSERT INTO certifications (
            provider_id, name, code, description, difficulty_level, 
            duration_minutes, passing_score, total_questions
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [
          providerId, cert.name, cert.code, cert.description, 
          cert.difficulty, cert.duration, cert.passing_score, cert.total_questions
        ]);
        certIds.push(result.rows[0].id);
      }
      
      // Insert topics for ACE certification
      const aceTopics = [
        { name: 'Setting up a cloud solution environment', weight: 17.5 },
        { name: 'Planning and configuring a cloud solution', weight: 17.5 },
        { name: 'Deploying and implementing a cloud solution', weight: 25.0 },
        { name: 'Ensuring successful operation of a cloud solution', weight: 25.0 },
        { name: 'Configuring access and security', weight: 15.0 }
      ];
      
      const topicIds = [];
      for (const topic of aceTopics) {
        const result = await client.query(`
          INSERT INTO topics (certification_id, name, description, weight_percentage)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `, [certIds[0], topic.name, `Topics related to ${topic.name}`, topic.weight]);
        topicIds.push(result.rows[0].id);
      }
      
      // Insert sample questions
      const sampleQuestions = [
        {
          topic_id: topicIds[0],
          question_text: 'Which Google Cloud service is used for container orchestration?',
          explanation: 'Google Kubernetes Engine (GKE) is the managed Kubernetes service on Google Cloud.',
          difficulty: 'medium',
          expected_answers: 1,
          points: 1.0,
          options: [
            { text: 'Google Kubernetes Engine', is_correct: true },
            { text: 'Google App Engine', is_correct: false },
            { text: 'Google Compute Engine', is_correct: false },
            { text: 'Google Cloud Functions', is_correct: false }
          ]
        },
        {
          topic_id: topicIds[1],
          question_text: 'Which of the following are valid Google Cloud storage classes? (Select all that apply)',
          explanation: 'Google Cloud offers Standard, Nearline, Coldline, and Archive storage classes.',
          difficulty: 'medium',
          expected_answers: 4,
          points: 2.0,
          options: [
            { text: 'Standard', is_correct: true },
            { text: 'Nearline', is_correct: true },
            { text: 'Coldline', is_correct: true },
            { text: 'Archive', is_correct: true },
            { text: 'Glacier', is_correct: false },
            { text: 'Frequent Access', is_correct: false }
          ]
        }
      ];
      
      // Get question type IDs
      const multipleChoiceType = await client.query('SELECT id FROM question_types WHERE name = $1', ['multiple_choice']);
      const multipleAnswerType = await client.query('SELECT id FROM question_types WHERE name = $1', ['multiple_answer']);
      
      for (let i = 0; i < sampleQuestions.length; i++) {
        const q = sampleQuestions[i];
        const questionTypeId = q.expected_answers > 1 ? multipleAnswerType.rows[0].id : multipleChoiceType.rows[0].id;
        
        // Insert question
        const questionResult = await client.query(`
          INSERT INTO questions (
            topic_id, question_type_id, question_text, explanation,
            difficulty_level, expected_answers_count, points, review_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [
          q.topic_id, questionTypeId, q.question_text, q.explanation,
          q.difficulty, q.expected_answers, q.points, 'approved'
        ]);
        
        const questionId = questionResult.rows[0].id;
        
        // Insert options
        for (let j = 0; j < q.options.length; j++) {
          const option = q.options[j];
          await client.query(`
            INSERT INTO question_options (
              question_id, option_label, option_text, is_correct, order_index
            ) VALUES ($1, $2, $3, $4, $5)
          `, [
            questionId,
            String.fromCharCode(65 + j), // A, B, C, D...
            option.text,
            option.is_correct,
            j + 1
          ]);
        }
      }
      
      await client.query('COMMIT');
      
      logger.info('Sample data created successfully');
      return {
        message: 'Sample data created successfully',
        certifications: certifications.length,
        topics: aceTopics.length,
        questions: sampleQuestions.length
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating sample data:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateQuestion(id, updateData) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Update question
      await client.query(`
        UPDATE questions 
        SET question_text = $1, explanation = $2, difficulty_level = $3,
            expected_answers_count = $4, points = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
      `, [
        updateData.text,
        updateData.explanation,
        updateData.difficulty,
        updateData.expectedAnswers,
        updateData.points,
        id
      ]);
      
      // Update options if provided
      if (updateData.options) {
        // Delete existing options
        await client.query('DELETE FROM question_options WHERE question_id = $1', [id]);
        
        // Insert new options
        for (let i = 0; i < updateData.options.length; i++) {
          const option = updateData.options[i];
          const isCorrect = updateData.correctAnswers.includes(i);
          
          await client.query(`
            INSERT INTO question_options (
              question_id, option_label, option_text, is_correct, order_index, explanation
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            id,
            option.label || String.fromCharCode(65 + i),
            option.text,
            isCorrect,
            i + 1,
            option.explanation
          ]);
        }
      }
      
      await client.query('COMMIT');
      
      return await this.getQuestionById(id);
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating question:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteQuestion(id) {
    try {
      const client = await this.pool.connect();
      
      // Soft delete - mark as inactive
      await client.query(
        'UPDATE questions SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [id]
      );
      
      client.release();
      
      logger.info(`Question ${id} marked as inactive`);
      return true;
    } catch (error) {
      logger.error('Error deleting question:', error);
      throw error;
    }
  }

  async getQuestionTypes() {
    try {
      const client = await this.pool.connect();
      const result = await client.query(`
        SELECT id, name, display_name, description
        FROM question_types
        WHERE is_active = true
        ORDER BY display_name
      `);
      client.release();
      
      return result.rows;
    } catch (error) {
      logger.error('Error getting question types:', error);
      return [];
    }
  }

  async searchQuestions(searchTerm, filters = {}) {
    try {
      let whereConditions = [
        'q.is_active = true', 
        "q.review_status = 'approved'",
        "(q.question_text ILIKE $1 OR q.explanation ILIKE $1)"
      ];
      let params = [`%${searchTerm}%`];

      // Apply additional filters
      if (filters.provider) {
        params.push(filters.provider.toLowerCase());
        whereConditions.push(`LOWER(p.name) = ${params.length}`);
      }

      if (filters.certification) {
        params.push(filters.certification.toLowerCase());
        whereConditions.push(`(LOWER(c.name) = ${params.length} OR LOWER(c.code) = ${params.length})`);
      }

      if (filters.difficulty) {
        params.push(filters.difficulty.toLowerCase());
        whereConditions.push(`q.difficulty_level = ${params.length}::difficulty_level`);
      }

      const whereClause = whereConditions.join(' AND ');
      
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit) || 20;
      const offset = (page - 1) * limit;
      
      params.push(limit);
      const limitParam = params.length;
      params.push(offset);
      const offsetParam = params.length;
      
      const query = `
        SELECT 
          q.id,
          q.external_id,
          q.question_text as text,
          q.explanation,
          q.difficulty_level as difficulty,
          q.expected_answers_count,
          q.points,
          t.name as topic_name,
          c.name as certification_name,
          c.code as certification_code,
          p.name as provider_name,
          qt.name as question_type,
          qt.display_name as question_type_display,
          ts_rank_cd(to_tsvector('english', q.question_text || ' ' || COALESCE(q.explanation, '')), 
                     plainto_tsquery('english', $1)) as relevance_score
        FROM questions q
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        JOIN question_types qt ON q.question_type_id = qt.id
        WHERE ${whereClause}
        ORDER BY relevance_score DESC, q.created_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `;

      const countQuery = `
        SELECT COUNT(*) 
        FROM questions q
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        JOIN question_types qt ON q.question_type_id = qt.id
        WHERE ${whereClause}
      `;

      const client = await this.pool.connect();
      
      // Get total count
      const countParams = params.slice(0, params.length - 2);
      const countResult = await client.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count);
      
      // Get questions
      const result = await client.query(query, params);
      client.release();

      return {
        questions: result.rows,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error searching questions:', error);
      return {
        questions: [],
        pagination: { total: 0, page: 1, limit: 20, pages: 0 }
      };
    }
  }

  async getQuestionsByDifficulty(difficulty, limit = 10) {
    try {
      const client = await this.pool.connect();
      const result = await client.query(`
        SELECT 
          q.id,
          q.question_text as text,
          q.difficulty_level as difficulty,
          t.name as topic_name,
          c.name as certification_name,
          p.name as provider_name
        FROM questions q
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        WHERE q.difficulty_level = $1::difficulty_level 
          AND q.is_active = true 
          AND q.review_status = 'approved'
        ORDER BY RANDOM()
        LIMIT $2
      `, [difficulty, limit]);
      client.release();
      
      return result.rows;
    } catch (error) {
      logger.error('Error getting questions by difficulty:', error);
      return [];
    }
  }

  // Method to get questions that need review
  async getQuestionsForReview(status = 'pending', limit = 50) {
    try {
      const client = await this.pool.connect();
      const result = await client.query(`
        SELECT 
          q.id,
          q.external_id,
          q.question_text as text,
          q.explanation,
          q.difficulty_level as difficulty,
          q.review_status,
          q.created_at,
          t.name as topic_name,
          c.name as certification_name,
          p.name as provider_name,
          COUNT(qo.id) as option_count
        FROM questions q
        JOIN topics t ON q.topic_id = t.id
        JOIN certifications c ON t.certification_id = c.id
        JOIN providers p ON c.provider_id = p.id
        LEFT JOIN question_options qo ON q.id = qo.question_id
        WHERE q.review_status = $1::review_status
        GROUP BY q.id, q.external_id, q.question_text, q.explanation, 
                 q.difficulty_level, q.review_status, q.created_at,
                 t.name, c.name, p.name
        ORDER BY q.created_at ASC
        LIMIT $2
      `, [status, limit]);
      client.release();
      
      return result.rows;
    } catch (error) {
      logger.error('Error getting questions for review:', error);
      return [];
    }
  }

  async approveQuestion(questionId, adminId) {
    try {
      const client = await this.pool.connect();
      await client.query(`
        UPDATE questions 
        SET review_status = 'approved', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [questionId]);
      client.release();
      
      logger.info(`Question ${questionId} approved by admin ${adminId}`);
      return true;
    } catch (error) {
      logger.error('Error approving question:', error);
      throw error;
    }
  }

  async rejectQuestion(questionId, adminId, reason) {
    try {
      const client = await this.pool.connect();
      await client.query(`
        UPDATE questions 
        SET review_status = 'rejected', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [questionId]);
      client.release();
      
      logger.info(`Question ${questionId} rejected by admin ${adminId}. Reason: ${reason}`);
      return true;
    } catch (error) {
      logger.error('Error rejecting question:', error);
      throw error;
    }
  }

  // Health check method
  async healthCheck() {
    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW() as server_time, version() as pg_version');
      client.release();
      
      return {
        status: 'healthy',
        database: 'connected',
        serverTime: result.rows[0].server_time,
        postgresVersion: result.rows[0].pg_version
      };
    } catch (error) {
      logger.error('Database health check failed:', error);
      return {
        status: 'unhealthy',
        database: 'disconnected',
        error: error.message
      };
    }
  }

  // Cleanup method
  async close() {
    try {
      await this.pool.end();
      logger.info('Database connection pool closed');
    } catch (error) {
      logger.error('Error closing database pool:', error);
    }
  }
}

module.exports = new QuestionService();