// config/config.js - Updated for PostgreSQL
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // JWT Configuration
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production',
  jwtExpire: process.env.JWT_EXPIRE || '7d',
  
  // Password hashing
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
  
  // File upload
  maxFileSize: process.env.MAX_FILE_SIZE || '5mb',
  
  // CORS
  allowedOrigins: process.env.ALLOWED_ORIGINS ? 
    process.env.ALLOWED_ORIGINS.split(',') : 
    ['http://localhost:5173', 'http://localhost:3000'],
  
  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100
  },
  
  // Database Configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'exam_system',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    
    // Connection pool settings
    pool: {
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      min: parseInt(process.env.DB_POOL_MIN) || 0,
      idle: parseInt(process.env.DB_POOL_IDLE) || 10000,
      acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
    },
    
    // Other database options
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    dialectOptions: process.env.NODE_ENV === 'production' ? {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    } : {}
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || null,
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: process.env.LOG_MAX_FILES || '5'
  },
  
  // Session configuration for anonymous users
  session: {
    secret: process.env.SESSION_SECRET || 'your-session-secret-change-this',
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 24 * 60 * 60 * 1000, // 24 hours
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  },
  
  // Exam configuration
  exam: {
    defaultTimeLimit: parseInt(process.env.DEFAULT_EXAM_TIME_LIMIT) || 120, // minutes
    maxQuestions: parseInt(process.env.MAX_EXAM_QUESTIONS) || 100,
    minQuestions: parseInt(process.env.MIN_EXAM_QUESTIONS) || 5,
    defaultPassingScore: parseFloat(process.env.DEFAULT_PASSING_SCORE) || 70.0,
    allowAnonymous: process.env.ALLOW_ANONYMOUS_EXAMS !== 'false'
  },
  
  // Redis configuration (if using Redis for caching)
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: parseInt(process.env.REDIS_DB) || 0,
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'exam_system:'
  },
  
  // Email configuration (if implementing email features)
  email: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || 'noreply@exam-system.com'
  },
  
  // API configuration
  api: {
    version: 'v1',
    prefix: '/api/v1',
    timeout: parseInt(process.env.API_TIMEOUT) || 30000
  },
  
  // Security settings
  security: {
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
    lockoutTime: parseInt(process.env.LOCKOUT_TIME) || 15 * 60 * 1000, // 15 minutes
    passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH) || 6,
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
    requireStrongPasswords: process.env.REQUIRE_STRONG_PASSWORDS === 'true'
  },
  
  // Feature flags
  features: {
    analytics: process.env.ENABLE_ANALYTICS !== 'false',
    feedback: process.env.ENABLE_FEEDBACK !== 'false',
    bookmarks: process.env.ENABLE_BOOKMARKS !== 'false',
    progress_tracking: process.env.ENABLE_PROGRESS_TRACKING !== 'false',
    exam_analytics: process.env.ENABLE_EXAM_ANALYTICS !== 'false'
  }
};