/**
 * @fileoverview Validation Schemas
 * Centralized request validation using Joi
 */

const Joi = require('joi');

// Custom validation messages
const messages = {
  'string.empty': '{#label} cannot be empty',
  'string.min': '{#label} must be at least {#limit} characters',
  'string.max': '{#label} must be at most {#limit} characters',
  'string.email': '{#label} must be a valid email',
  'number.min': '{#label} must be at least {#limit}',
  'number.max': '{#label} must be at most {#limit}',
  'any.required': '{#label} is required',
  'any.only': '{#label} must be one of {#valids}',
  'array.min': '{#label} must have at least {#limit} items',
  'array.max': '{#label} must have at most {#limit} items',
};

// Common field schemas
const fields = {
  id: Joi.number().integer().positive(),
  uuid: Joi.string().uuid({ version: 'uuidv4' }),
  email: Joi.string().email().max(255).lowercase().trim(),
  password: Joi.string().min(6).max(128),
  username: Joi.string().alphanum().min(3).max(50).trim(),
  role: Joi.string().valid('admin', 'instructor', 'student'),
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().max(50),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  },
};

// Auth schemas
const authSchemas = {
  register: Joi.object({
    username: fields.username.required(),
    email: fields.email.required(),
    password: fields.password.required(),
    firstName: Joi.string().max(100).trim(),
    lastName: Joi.string().max(100).trim(),
  }).messages(messages),

  login: Joi.object({
    email: Joi.string().required(),
    password: Joi.string().required(),
  }).messages(messages),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: fields.password.required(),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
      .messages({ 'any.only': 'Passwords do not match' }),
  }).messages(messages),

  resetPassword: Joi.object({
    token: Joi.string().required(),
    password: fields.password.required(),
    confirmPassword: Joi.string().valid(Joi.ref('password')).required()
      .messages({ 'any.only': 'Passwords do not match' }),
  }).messages(messages),

  forgotPassword: Joi.object({
    email: fields.email.required(),
  }).messages(messages),
};

// User schemas
const userSchemas = {
  update: Joi.object({
    firstName: Joi.string().max(100).trim(),
    lastName: Joi.string().max(100).trim(),
    email: fields.email,
    role: fields.role,
    isActive: Joi.boolean(),
    isValidated: Joi.boolean(),
  }).min(1).messages(messages),

  list: Joi.object({
    ...fields.pagination,
    role: fields.role,
    isActive: Joi.boolean(),
    search: Joi.string().max(100).trim(),
  }).messages(messages),
};

// Exam schemas
const examSchemas = {
  create: Joi.object({
    provider: Joi.number().integer().positive().required(),
    certification: Joi.number().integer().positive().required(),
    mode: Joi.string().valid('practice', 'timed', 'simulation', 'failed_questions').default('practice'),
    questionCount: Joi.number().integer().min(1).max(200),
    timeLimit: Joi.number().integer().min(1).max(480),
    difficulty: Joi.string().valid('easy', 'medium', 'hard', 'expert', 'mixed'),
    category: Joi.number().integer().positive(),
    settings: Joi.object({
      randomizeQuestions: Joi.boolean().default(true),
      randomizeAnswers: Joi.boolean().default(false),
      showExplanations: Joi.boolean().default(true),
      allowPause: Joi.boolean().default(true),
      allowReview: Joi.boolean().default(true),
    }),
  }).messages(messages),

  submitAnswer: Joi.object({
    questionId: Joi.alternatives().try(
      Joi.number().integer().positive(),
      Joi.string().uuid()
    ).required(),
    answer: Joi.alternatives().try(
      Joi.number().integer().min(0),
      Joi.array().items(Joi.number().integer().min(0)).min(1)
    ).required(),
    timeSpent: Joi.number().integer().min(0),
  }).messages(messages),

  list: Joi.object({
    ...fields.pagination,
    status: Joi.string().valid('pending', 'active', 'paused', 'completed', 'cancelled'),
    certification: Joi.number().integer().positive(),
    mode: Joi.string().valid('practice', 'timed', 'simulation', 'failed_questions'),
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')),
  }).messages(messages),
};

// Question schemas
const questionSchemas = {
  create: Joi.object({
    text: Joi.string().min(10).max(5000).required(),
    explanation: Joi.string().max(5000),
    certificationId: Joi.number().integer().positive().required(),
    topicId: Joi.number().integer().positive(),
    difficulty: Joi.string().valid('easy', 'medium', 'hard', 'expert').default('medium'),
    points: Joi.number().integer().min(1).max(10).default(1),
    timeEstimate: Joi.number().integer().min(1).max(600),
    tags: Joi.array().items(Joi.string().max(50)).max(10),
    options: Joi.array().items(
      Joi.object({
        label: Joi.string().max(5).required(),
        text: Joi.string().max(2000).required(),
        isCorrect: Joi.boolean().default(false),
      })
    ).min(2).max(10).required(),
    correctAnswers: Joi.array().items(Joi.number().integer().min(0)).min(1),
  }).messages(messages),

  update: Joi.object({
    text: Joi.string().min(10).max(5000),
    explanation: Joi.string().max(5000),
    topicId: Joi.number().integer().positive(),
    difficulty: Joi.string().valid('easy', 'medium', 'hard', 'expert'),
    points: Joi.number().integer().min(1).max(10),
    timeEstimate: Joi.number().integer().min(1).max(600),
    tags: Joi.array().items(Joi.string().max(50)).max(10),
    isActive: Joi.boolean(),
    options: Joi.array().items(
      Joi.object({
        label: Joi.string().max(5).required(),
        text: Joi.string().max(2000).required(),
        isCorrect: Joi.boolean().default(false),
      })
    ).min(2).max(10),
    correctAnswers: Joi.array().items(Joi.number().integer().min(0)).min(1),
  }).min(1).messages(messages),

  list: Joi.object({
    ...fields.pagination,
    providerId: Joi.number().integer().positive(),
    certificationId: Joi.number().integer().positive(),
    topicId: Joi.number().integer().positive(),
    difficulty: Joi.string().valid('easy', 'medium', 'hard', 'expert'),
    reviewStatus: Joi.string().valid('pending', 'approved', 'rejected', 'needs_revision'),
    search: Joi.string().max(200).trim(),
    tags: Joi.alternatives().try(
      Joi.string(),
      Joi.array().items(Joi.string())
    ),
    isActive: Joi.boolean(),
  }).messages(messages),

  random: Joi.object({
    count: Joi.number().integer().min(1).max(100).default(10),
    certificationId: Joi.number().integer().positive(),
    topicIds: Joi.array().items(Joi.number().integer().positive()),
    difficulty: Joi.string().valid('easy', 'medium', 'hard', 'expert'),
    excludeIds: Joi.array().items(
      Joi.alternatives().try(Joi.number().integer(), Joi.string().uuid())
    ),
  }).messages(messages),

  report: Joi.object({
    reason: Joi.string().valid(
      'incorrect_answer',
      'outdated',
      'unclear',
      'duplicate',
      'offensive',
      'other'
    ).required(),
    description: Joi.string().max(1000),
  }).messages(messages),

  review: Joi.object({
    status: Joi.string().valid('approved', 'rejected', 'needs_revision').required(),
    comments: Joi.string().max(1000),
  }).messages(messages),
};

/**
 * Validation middleware factory
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {string} property - Request property to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: errors,
        },
      });
    }

    // Replace request property with validated/sanitized value
    req[property] = value;
    next();
  };
};

module.exports = {
  validate,
  fields,
  authSchemas,
  userSchemas,
  examSchemas,
  questionSchemas,
};
