// src/middleware/validation.js - Request validation middleware
const Question = require('../models/Question');

const validationSchemas = {
  createQuestion: {
    required: ['text', 'options', 'correctAnswers', 'category', 'provider'],
    optional: ['explanation', 'difficulty', 'expectedAnswers', 'points', 'questionType', 'certification', 'externalId', 'tags']
  },
  updateQuestion: {
    required: [],
    optional: ['text', 'options', 'correctAnswers', 'explanation', 'difficulty', 'expectedAnswers', 'points', 'questionType', 'tags']
  },
  rejectQuestion: {
    required: ['reason'],
    optional: []
  }
};

const validateRequest = (schemaName) => {
  return (req, res, next) => {
    const schema = validationSchemas[schemaName];
    
    if (!schema) {
      return res.status(500).json({
        success: false,
        error: 'Invalid validation schema'
      });
    }

    const errors = [];
    
    // Check required fields
    for (const field of schema.required) {
      if (!(field in req.body) || req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
        errors.push(`Field '${field}' is required`);
      }
    }

    // Validate question-specific fields if it's a question operation
    if (schemaName.includes('Question') && schemaName !== 'rejectQuestion') {
      const questionErrors = Question.validate(req.body);
      errors.push(...questionErrors);
      
      if (req.body.options) {
        const optionErrors = Question.validateOptions(req.body.options);
        errors.push(...optionErrors);
      }
    }

    // Validate field types and formats
    if (req.body.difficulty && !['easy', 'medium', 'hard', 'expert'].includes(req.body.difficulty)) {
      errors.push('Difficulty must be one of: easy, medium, hard, expert');
    }

    if (req.body.expectedAnswers && (!Number.isInteger(req.body.expectedAnswers) || req.body.expectedAnswers < 1 || req.body.expectedAnswers > 8)) {
      errors.push('Expected answers must be an integer between 1 and 8');
    }

    if (req.body.points && (typeof req.body.points !== 'number' || req.body.points < 0.1 || req.body.points > 100)) {
      errors.push('Points must be a number between 0.1 and 100');
    }

    if (req.body.text && req.body.text.length > 5000) {
      errors.push('Question text is too long (max 5000 characters)');
    }

    if (req.body.explanation && req.body.explanation.length > 2000) {
      errors.push('Explanation is too long (max 2000 characters)');
    }

    if (req.body.reason && req.body.reason.length > 1000) {
      errors.push('Reason is too long (max 1000 characters)');
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    next();
  };
};

// Specific validation functions
const validateQuestionId = (req, res, next) => {
  const { id } = req.params;
  
  if (!id || isNaN(parseInt(id)) || parseInt(id) <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid question ID'
    });
  }
  
  req.params.id = parseInt(id);
  next();
};

const validatePagination = (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;
  
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  
  if (isNaN(pageNum) || pageNum < 1) {
    return res.status(400).json({
      success: false,
      error: 'Page must be a positive integer'
    });
  }
  
  if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return res.status(400).json({
      success: false,
      error: 'Limit must be between 1 and 100'
    });
  }
  
  req.query.page = pageNum;
  req.query.limit = limitNum;
  next();
};

const validateFilters = (req, res, next) => {
  const { difficulty, questionType } = req.query;
  
  if (difficulty) {
    const validDifficulties = ['easy', 'medium', 'hard', 'expert'];
    if (!validDifficulties.includes(difficulty.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Difficulty must be one of: ${validDifficulties.join(', ')}`
      });
    }
    req.query.difficulty = difficulty.toLowerCase();
  }
  
  if (questionType) {
    const validTypes = ['multiple_choice', 'multiple_answer', 'true_false', 'fill_blank', 'essay', 'matching', 'ordering'];
    if (!validTypes.includes(questionType.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Question type must be one of: ${validTypes.join(', ')}`
      });
    }
    req.query.questionType = questionType.toLowerCase();
  }
  
  next();
};

const sanitizeInput = (req, res, next) => {
  // Sanitize string inputs to prevent XSS
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str.trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  };
  
  // Sanitize request body
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeString(req.body[key]);
      } else if (Array.isArray(req.body[key])) {
        req.body[key] = req.body[key].map(item => 
          typeof item === 'string' ? sanitizeString(item) : item
        );
      } else if (typeof req.body[key] === 'object' && req.body[key] !== null) {
        // Handle nested objects (like options)
        for (const nestedKey in req.body[key]) {
          if (typeof req.body[key][nestedKey] === 'string') {
            req.body[key][nestedKey] = sanitizeString(req.body[key][nestedKey]);
          }
        }
      }
    }
  }
  
  // Sanitize query parameters
  if (req.query) {
    for (const key in req.query) {
      if (typeof req.query[key] === 'string') {
        req.query[key] = sanitizeString(req.query[key]);
      }
    }
  }
  
  next();
};

const validateSearchQuery = (req, res, next) => {
  const { search } = req.query;
  
  if (search) {
    if (search.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters long'
      });
    }
    
    if (search.length > 200) {
      return res.status(400).json({
        success: false,
        error: 'Search query is too long (max 200 characters)'
      });
    }
    
    // Basic validation to prevent SQL injection attempts
    if (/[;<>'"\\]/.test(search)) {
      return res.status(400).json({
        success: false,
        error: 'Search query contains invalid characters'
      });
    }
  }
  
  next();
};

const validateAnswerSubmission = (req, res, next) => {
  const { answer, timeSpent } = req.body;
  
  if (answer === undefined || answer === null) {
    return res.status(400).json({
      success: false,
      error: 'Answer is required'
    });
  }
  
  // Validate answer format
  if (Array.isArray(answer)) {
    if (answer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Answer array cannot be empty'
      });
    }
    
    if (answer.length > 8) {
      return res.status(400).json({
        success: false,
        error: 'Too many answers provided'
      });
    }
    
    // Validate each answer index
    for (const ans of answer) {
      if (!Number.isInteger(ans) || ans < 0 || ans > 7) {
        return res.status(400).json({
          success: false,
          error: 'Invalid answer index'
        });
      }
    }
  } else {
    // Single answer
    if (!Number.isInteger(answer) || answer < 0 || answer > 7) {
      return res.status(400).json({
        success: false,
        error: 'Invalid answer index'
      });
    }
  }
  
  // Validate time spent if provided
  if (timeSpent !== undefined) {
    if (!Number.isInteger(timeSpent) || timeSpent < 0 || timeSpent > 3600) {
      return res.status(400).json({
        success: false,
        error: 'Time spent must be between 0 and 3600 seconds'
      });
    }
  }
  
  next();
};

const validateBulkOperation = (req, res, next) => {
  const { ids } = req.body;
  
  if (!Array.isArray(ids)) {
    return res.status(400).json({
      success: false,
      error: 'IDs must be provided as an array'
    });
  }
  
  if (ids.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'At least one ID must be provided'
    });
  }
  
  if (ids.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Too many IDs provided (max 100)'
    });
  }
  
  // Validate each ID
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: 'All IDs must be positive integers'
      });
    }
  }
  
  next();
};

const validateReviewStatus = (req, res, next) => {
  const { status } = req.query;
  
  if (status) {
    const validStatuses = ['pending', 'approved', 'rejected', 'needs_revision'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }
  }
  
  next();
};

// Error handling for validation middleware
const handleValidationError = (error, req, res, next) => {
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.errors
    });
  }
  
  next(error);
};

module.exports = {
  validateRequest,
  validateQuestionId,
  validatePagination,
  validateFilters,
  sanitizeInput,
  validateSearchQuery,
  validateAnswerSubmission,
  validateBulkOperation,
  validateReviewStatus,
  handleValidationError
};