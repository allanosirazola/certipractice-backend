// src/controllers/questionController.js - Updated for PostgreSQL
const QuestionService = require('../services/questionService');
const Question = require('../models/Question');
const logger = require('../utils/logger');

const getQuestions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      provider,
      certification,
      category,
      topic,
      difficulty,
      questionType,
      search,
      includeStats = 'false'
    } = req.query;

    const filters = {};
    
    if (provider) filters.provider = provider;
    if (certification) filters.certification = certification;
    if (category) filters.category = category;
    if (topic) filters.topic = topic;
    if (difficulty) filters.difficulty = difficulty;
    if (questionType) filters.questionType = questionType;
    
    // Add pagination to filters
    filters.page = parseInt(page);
    filters.limit = parseInt(limit);

    let result;
    
    // Use search if provided
    if (search && search.trim().length > 0) {
      result = await QuestionService.searchQuestions(search.trim(), filters);
    } else {
      result = await QuestionService.getQuestions(filters);
    }

    // Include stats if requested and user is admin
    const shouldIncludeStats = includeStats === 'true' && req.user && req.user.isAdmin;

    res.json({
      success: true,
      data: result.questions.map(q => 
        shouldIncludeStats ? q.getComplete() : q.getSanitized()
      ),
      pagination: result.pagination,
      filters: filters
    });
  } catch (error) {
    logger.error('Error in getQuestions controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getQuestionById = async (req, res) => {
  try {
    const { id } = req.params;
    const { includeAnswers = 'false', includeStats = 'false' } = req.query;
    
    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid question ID'
      });
    }

    const shouldIncludeStats = includeStats === 'true' && req.user && req.user.isAdmin;
    const question = await QuestionService.getQuestionById(parseInt(id), shouldIncludeStats);

    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }
    const shouldIncludeAnswers = includeAnswers === 'true' || 
                             req.headers['x-include-answers'] === 'true' ||
                             (req.user && req.user.isAdmin);
    // Decide whether to include correct answers based on permissions
    let responseData;
    if (shouldIncludeAnswers) {
      responseData = {
        ...question.getComplete(),
        // Asegurar que correctAnswer esté disponible para verificación
        correctAnswer: question.isMultipleChoice ? question.correctAnswers : question.correctAnswers[0]
      };
    } else {
      responseData = question.getSanitized();
}
    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    logger.error('Error in getQuestionById controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const createQuestion = async (req, res) => {
  try {
    // Validate input
    const validationErrors = Question.validate(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validationErrors
      });
    }

    // Validate options
    if (req.body.options) {
      const optionErrors = Question.validateOptions(req.body.options);
      if (optionErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Option validation failed',
          details: optionErrors
        });
      }
    }

    const question = await QuestionService.createQuestion(req.body);
    
    res.status(201).json({
      success: true,
      data: question.getComplete(),
      message: 'Question created successfully'
    });
  } catch (error) {
    logger.error('Error in createQuestion controller:', error);
    
    if (error.message.includes('not found')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid question ID'
      });
    }

    // Check if question exists
    const existingQuestion = await QuestionService.getQuestionById(parseInt(id));
    if (!existingQuestion) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }

    // Validate input
    const validationErrors = Question.validate(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validationErrors
      });
    }

    // Validate options if provided
    if (req.body.options) {
      const optionErrors = Question.validateOptions(req.body.options);
      if (optionErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Option validation failed',
          details: optionErrors
        });
      }
    }

    const question = await QuestionService.updateQuestion(parseInt(id), req.body);
    
    res.json({
      success: true,
      data: question.getComplete(),
      message: 'Question updated successfully'
    });
  } catch (error) {
    logger.error('Error in updateQuestion controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid question ID'
      });
    }

    // Check if question exists
    const existingQuestion = await QuestionService.getQuestionById(parseInt(id));
    if (!existingQuestion) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }

    await QuestionService.deleteQuestion(parseInt(id));
    
    res.json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    logger.error('Error in deleteQuestion controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getCategories = async (req, res) => {
  try {
    const { certification } = req.query;
    const categories = await QuestionService.getCategories(certification);
    
    res.json({
      success: true,
      data: categories,
      count: categories.length
    });
  } catch (error) {
    logger.error('Error in getCategories controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

const getProviders = async (req, res) => {
  try {
    const providers = await QuestionService.getProviders();
    
    res.json({
      success: true,
      data: providers,
      count: providers.length
    });
  } catch (error) {
    logger.error('Error in getProviders controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

const getCertifications = async (req, res) => {
  try {
    const { provider } = req.query;
    const certifications = await QuestionService.getCertifications(provider);
    console.log(certifications)
    console.log(provider)
    res.json({
      success: true,
      data: certifications,
      count: certifications.length,
      provider: provider || null
    });
  } catch (error) {
    logger.error('Error in getCertifications controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Get question type statistics
const getQuestionTypeStats = async (req, res) => {
  try {
    const stats = await QuestionService.getQuestionTypeStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error in getQuestionTypeStats controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Validate question format
const validateQuestion = async (req, res) => {
  try {
    // Validate basic structure
    const errors = Question.validate(req.body);
    
    // Validate options if present
    if (req.body.options) {
      const optionErrors = Question.validateOptions(req.body.options);
      errors.push(...optionErrors);
    }
    
    const isValid = errors.length === 0;
    
    res.json({
      success: true,
      data: {
        isValid: isValid,
        errors: errors,
        warnings: isValid ? [] : ['Question has validation errors'],
        suggestions: isValid ? ['Question format is valid'] : []
      }
    });
  } catch (error) {
    logger.error('Error in validateQuestion controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Get random questions for exam
const getRandomQuestions = async (req, res) => {
  try {
    const {
      count = 20,
      provider,
      certification,
      category,
      topic,
      difficulty,
      questionType
    } = req.query;

    // Validate count
    const questionCount = parseInt(count);
    if (isNaN(questionCount) || questionCount < 1 || questionCount > 100) {
      return res.status(400).json({
        success: false,
        error: 'Count must be between 1 and 100'
      });
    }

    const filters = {};
    if (provider) filters.provider = provider;
    if (certification) filters.certification = certification;
    if (category) filters.category = category;
    if (topic) filters.topic = topic;
    if (difficulty) filters.difficulty = difficulty;
    if (questionType) filters.questionType = questionType;

    const questions = await QuestionService.getRandomQuestions(questionCount, filters);

    // Sanitize questions for exam (without correct answers)
    const sanitizedQuestions = questions.map(q => q.getSanitized());

    res.json({
      success: true,
      data: {
        questions: sanitizedQuestions,
        count: sanitizedQuestions.length,
        requested: questionCount,
        filters: filters
      }
    });
  } catch (error) {
    logger.error('Error in getRandomQuestions controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Check answer for a specific question
const checkAnswer = async (req, res) => {
  try {
    const { id } = req.params;
    const { answer, timeSpent } = req.body;

    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid question ID'
      });
    }

    if (answer === undefined || answer === null) {
      return res.status(400).json({
        success: false,
        error: 'Answer is required'
      });
    }

    const question = await QuestionService.getQuestionById(parseInt(id), true);
    
    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }

    const isCorrect = question.isAnswerCorrect(answer);
    
    // Update question statistics if timeSpent is provided
    if (timeSpent && timeSpent > 0) {
      await QuestionService.updateQuestionStats(parseInt(id), isCorrect, timeSpent);
    }
    
    // Return result with explanation if correct, or just correctness if wrong
    const response = {
      questionId: parseInt(id),
      isCorrect: isCorrect,
      points: isCorrect ? question.points : 0
    };

    // Only show explanation and correct answers if the answer is correct
    // or if the user is an admin
    if (isCorrect || (req.user && req.user.isAdmin)) {
      response.explanation = question.explanation;
      response.correctAnswers = question.correctAnswers;
    }

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    logger.error('Error in checkAnswer controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Get question metadata without sensitive content
const getQuestionMetadata = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid question ID'
      });
    }

    const question = await QuestionService.getQuestionById(parseInt(id));

    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }

    const metadata = question.getMetadata();
    
    res.json({
      success: true,
      data: metadata
    });
  } catch (error) {
    logger.error('Error in getQuestionMetadata controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Get questions by difficulty
const getQuestionsByDifficulty = async (req, res) => {
  try {
    const { difficulty } = req.params;
    const { limit = 10 } = req.query;

    const validDifficulties = ['easy', 'medium', 'hard', 'expert'];
    if (!validDifficulties.includes(difficulty)) {
      return res.status(400).json({
        success: false,
        error: `Difficulty must be one of: ${validDifficulties.join(', ')}`
      });
    }

    const questions = await QuestionService.getQuestionsByDifficulty(difficulty, parseInt(limit));
    
    res.json({
      success: true,
      data: questions,
      difficulty: difficulty,
      count: questions.length
    });
  } catch (error) {
    logger.error('Error in getQuestionsByDifficulty controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Get question types
const getQuestionTypes = async (req, res) => {
  try {
    const questionTypes = await QuestionService.getQuestionTypes();
    
    res.json({
      success: true,
      data: questionTypes,
      count: questionTypes.length
    });
  } catch (error) {
    logger.error('Error in getQuestionTypes controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Admin functions
const getQuestionsForReview = async (req, res) => {
  try {
    const { status = 'pending', limit = 50 } = req.query;
    
    const validStatuses = ['pending', 'approved', 'rejected', 'needs_revision'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    const questions = await QuestionService.getQuestionsForReview(status, parseInt(limit));
    
    res.json({
      success: true,
      data: questions,
      status: status,
      count: questions.length
    });
  } catch (error) {
    logger.error('Error in getQuestionsForReview controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

const approveQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid question ID'
      });
    }

    await QuestionService.approveQuestion(parseInt(id), req.user.id);
    
    res.json({
      success: true,
      message: 'Question approved successfully'
    });
  } catch (error) {
    logger.error('Error in approveQuestion controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

const rejectQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid question ID'
      });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Rejection reason is required'
      });
    }

    await QuestionService.rejectQuestion(parseInt(id), req.user.id, reason);
    
    res.json({
      success: true,
      message: 'Question rejected successfully'
    });
  } catch (error) {
    logger.error('Error in rejectQuestion controller:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Health check
const healthCheck = async (req, res) => {
  try {
    const health = await QuestionService.healthCheck();
    
    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    logger.error('Error in healthCheck controller:', error);
    res.status(500).json({
      success: false,
      error: 'Health check failed'
    });
  }
};

// Create sample data (admin only)
const createSampleData = async (req, res) => {
  try {
    const result = await QuestionService.createSampleData();
    
    res.json({
      success: true,
      data: result,
      message: 'Sample data created successfully'
    });
  } catch (error) {
    logger.error('Error in createSampleData controller:', error);
    
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to create sample data',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  getQuestions,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  getCategories,
  getProviders,
  getCertifications,
  getQuestionTypeStats,
  validateQuestion,
  getRandomQuestions,
  checkAnswer,
  getQuestionMetadata,
  getQuestionsByDifficulty,
  getQuestionTypes,
  getQuestionsForReview,
  approveQuestion,
  rejectQuestion,
  healthCheck,
  createSampleData
};