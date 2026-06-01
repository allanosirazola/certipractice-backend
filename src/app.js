const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

const config = require('./config/config');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { notFoundHandler } = require('./middleware/errorHandler');

// Routes
const authRoutes = require('./routes/auth');
const questionRoutes = require('./routes/questions');
const examRoutes = require('./routes/exams');
const userRoutes = require('./routes/users');
const statsRoutes = require('./routes/stats');
const healthRoutes = require('./routes/health');
const analyticsRoutes = require('./routes/analytics');
const adminAnalyticsRoutes = require('./routes/adminAnalytics');
const engagementRoutes = require('./routes/engagement');
const searchRoutes = require('./routes/search');
const progressRoutes = require('./routes/progress');
const reviewsRoutes = require('./routes/reviews');
const dailyQuizRoutes = require('./routes/dailyQuiz');
const studyPlansRoutes = require('./routes/studyPlans');

// Telemetry middleware
const { trackPageView } = require('./middleware/telemetry');

const app = express();

// Trust proxy (for correct IP in rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
// Production domains are always allowed so a missing/short ALLOWED_ORIGINS env
// var can't break the live site. Extra origins can still be added via
// ALLOWED_ORIGINS (comma-separated). Vercel preview deployments are allowed too.
const STATIC_ALLOWED_ORIGINS = [
  'https://certipractice.com',
  'https://www.certipractice.com',
  'https://certipractice.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

const isAllowedOrigin = (origin) => {
  const configured = config.allowedOrigins || [];
  if (STATIC_ALLOWED_ORIGINS.includes(origin)) return true;
  if (configured.includes(origin)) return true;
  if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) return true;
  // Allow Vercel preview deployments (e.g. certipractice-*.vercel.app).
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
  return false;
};

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server).
    if (!origin) return callback(null, true);

    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked request from:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID', 'X-Request-ID'],
  exposedHeaders: ['X-Session-Id', 'X-New-Token', 'X-Total-Count'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit?.windowMs || 15 * 60 * 1000,
  max: config.rateLimit?.max || 100,
  message: {
    success: false,
    error: {
      message: 'Too many requests, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/health'),
});

const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 50,
  delayMs: (hits) => hits * 100,
  maxDelayMs: 2000,
});

app.use(limiter);
app.use(speedLimiter);

// Body parsing middleware
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
}));

// Request ID middleware
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || require('uuid').v4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Logging
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, { 
  stream: { 
    write: (message) => logger.http(message.trim()) 
  },
  skip: (req) => req.path === '/health' || req.path === '/health/live',
}));

// Health check routes (before auth)
app.use('/health', healthRoutes);

// Telemetry: track page views automatically (after parsing, before routes)
app.use(trackPageView);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin/analytics', adminAnalyticsRoutes);
app.use('/api/engagement', engagementRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/daily-quiz', dailyQuizRoutes);
app.use('/api/study-plans', studyPlansRoutes);

// API version prefix (optional, for future versioning)
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/questions', questionRoutes);
app.use('/api/v1/exams', examRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/stats', statsRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/admin/analytics', adminAnalyticsRoutes);
app.use('/api/v1/engagement', engagementRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/progress', progressRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown handler
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  // Close server and database connections
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

module.exports = app;
