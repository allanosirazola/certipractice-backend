// config/config.js - Updated for PostgreSQL + standardized structure
require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const port = parseInt(process.env.PORT) || 3000;

const config = {
  port,
  nodeEnv,

  // Environment flags
  isProduction: nodeEnv === 'production',
  isDevelopment: nodeEnv === 'development',
  isTest: nodeEnv === 'test',

  // ─── JWT Configuration ────────────────────────────────────────────────
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production',
    expiresIn: process.env.JWT_EXPIRE || '7d',
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
  },
  // Legacy alias
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production',
  jwtExpire: process.env.JWT_EXPIRE || '7d',

  // ─── Bcrypt Configuration ─────────────────────────────────────────────
  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
  },
  // Legacy alias
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,

  // ─── File upload ──────────────────────────────────────────────────────
  maxFileSize: process.env.MAX_FILE_SIZE || '5mb',

  // ─── CORS ─────────────────────────────────────────────────────────────
  cors: {
    origins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
      : ['http://localhost:5173', 'http://localhost:3000'],
    credentials: process.env.CORS_CREDENTIALS !== 'false',
  },
  // Legacy alias
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
    : ['http://localhost:5173', 'http://localhost:3000'],

  // ─── Rate limiting ────────────────────────────────────────────────────
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    standardHeaders: true,
    legacyHeaders: false,
  },

  // ─── Database Configuration ───────────────────────────────────────────
  database: {
    url: process.env.DATABASE_URL || null,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'exam_system',
    name: process.env.DB_NAME || 'exam_system',
    username: process.env.DB_USER || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: nodeEnv === 'production',

    pool: {
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      min: parseInt(process.env.DB_POOL_MIN) || 0,
      idle: parseInt(process.env.DB_POOL_IDLE) || 10000,
      acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT) || 5000,
    },

    logging: nodeEnv === 'development' ? console.log : false,
    dialectOptions:
      nodeEnv === 'production'
        ? {
            ssl: {
              require: true,
              rejectUnauthorized: false,
            },
          }
        : {},
  },

  // ─── Logging configuration ────────────────────────────────────────────
  logging: {
    level: process.env.LOG_LEVEL || (nodeEnv === 'test' ? 'error' : 'info'),
    file: process.env.LOG_FILE || null,
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: process.env.LOG_MAX_FILES || '5',
  },

  // ─── Session configuration ────────────────────────────────────────────
  session: {
    secret: process.env.SESSION_SECRET || 'your-session-secret-change-this',
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 24 * 60 * 60 * 1000,
    secure: nodeEnv === 'production',
    httpOnly: true,
    sameSite: 'lax',
    useCookies: process.env.SESSION_USE_COOKIES !== 'false',
  },

  // ─── Exam configuration ───────────────────────────────────────────────
  exam: {
    defaultTimeLimit: parseInt(process.env.DEFAULT_EXAM_TIME_LIMIT) || 120,
    maxTimeLimit: parseInt(process.env.MAX_EXAM_TIME_LIMIT) || 480, // 8 hours
    maxQuestions: parseInt(process.env.MAX_EXAM_QUESTIONS) || 100,
    minQuestions: parseInt(process.env.MIN_EXAM_QUESTIONS) || 5,
    defaultPassingScore: parseFloat(process.env.DEFAULT_PASSING_SCORE) || 70.0,
    allowAnonymous: process.env.ALLOW_ANONYMOUS_EXAMS !== 'false',
  },

  // ─── Redis configuration ──────────────────────────────────────────────
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: parseInt(process.env.REDIS_DB) || 0,
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'exam_system:',
  },

  // ─── Email configuration ──────────────────────────────────────────────
  email: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || 'noreply@exam-system.com',
  },

  // ─── API configuration ────────────────────────────────────────────────
  api: {
    version: 'v1',
    prefix: '/api/v1',
    timeout: parseInt(process.env.API_TIMEOUT) || 30000,
  },

  // ─── Security settings ────────────────────────────────────────────────
  security: {
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
    lockoutTime: parseInt(process.env.LOCKOUT_TIME) || 15 * 60 * 1000,
    passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH) || 8,
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
    requireStrongPasswords: process.env.REQUIRE_STRONG_PASSWORDS === 'true',
  },

  // ─── Feature flags ────────────────────────────────────────────────────
  features: {
    analytics: process.env.ENABLE_ANALYTICS !== 'false',
    feedback: process.env.ENABLE_FEEDBACK !== 'false',
    bookmarks: process.env.ENABLE_BOOKMARKS !== 'false',
    progress_tracking: process.env.ENABLE_PROGRESS_TRACKING !== 'false',
    exam_analytics: process.env.ENABLE_EXAM_ANALYTICS !== 'false',
  },
};

module.exports = config;
