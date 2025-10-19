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
const notFound = require('./middleware/notFound');

// Routes
const authRoutes = require('./routes/auth');
const questionRoutes = require('./routes/questions');
const examRoutes = require('./routes/exams');
const userRoutes = require('./routes/users');
const statsRoutes = require('./routes/stats');

const app = express();

// Security middleware
app.use(helmet());
// CORS configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim());

console.log('Allowed CORS origins:', allowedOrigins); // Para debugging

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600,
  optionsSuccessStatus: 200 // Para navegadores legacy
}));

// Manejar OPTIONS requests explícitamente
app.options('*', cors());
// Rate limiting

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // allow 50 requests per 15 minutes at full speed
  delayMs: 500 // slow down subsequent requests by 500ms per request
});

app.use(limiter);
app.use(speedLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stats', statsRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

module.exports = app;
