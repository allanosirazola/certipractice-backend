// src/middleware/rateLimit.js - Rate limiting middleware
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * In-memory store with automatic cleanup of expired entries
 */
class MemoryStoreWithCleanup {
  constructor(windowMs = 60000) {
    this.windowMs = windowMs;
    this.hits = new Map();
    this.cleanupInterval = null;

    // Only set up cleanup interval outside test env
    if (process.env.NODE_ENV !== 'test') {
      this.cleanupInterval = setInterval(() => this.cleanup(), windowMs);
      // Don't keep process alive solely for the interval
      if (this.cleanupInterval.unref) this.cleanupInterval.unref();
    }
  }

  increment(key) {
    const now = Date.now();
    const record = this.hits.get(key) || { count: 0, resetAt: now + this.windowMs };

    // Reset if window expired
    if (now >= record.resetAt) {
      record.count = 0;
      record.resetAt = now + this.windowMs;
    }

    record.count++;
    this.hits.set(key, record);

    return {
      totalHits: record.count,
      resetTime: new Date(record.resetAt),
    };
  }

  decrement(key) {
    const record = this.hits.get(key);
    if (record && record.count > 0) {
      record.count--;
      this.hits.set(key, record);
    }
  }

  resetKey(key) {
    this.hits.delete(key);
  }

  resetAll() {
    this.hits.clear();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.hits.entries()) {
      if (now >= record.resetAt) {
        this.hits.delete(key);
      }
    }
  }

  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.hits.clear();
  }
}

/**
 * Default key generator: prefer user, then session, then IP
 */
const defaultKeyGenerator = (req) => {
  if (req.user?.id) return `user:${req.user.id}`;
  if (req.sessionId) return `session:${req.sessionId}`;
  return `ip:${req.ip || 'unknown'}`;
};

/**
 * Create a rate limiter with sensible defaults
 */
const createRateLimiter = (options = {}) => {
  const cfg = config.rateLimit || {};
  const windowMs = options.windowMs || cfg.windowMs || 15 * 60 * 1000;
  const max = options.max || cfg.max || 100;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: options.standardHeaders ?? cfg.standardHeaders ?? true,
    legacyHeaders: options.legacyHeaders ?? cfg.legacyHeaders ?? false,
    keyGenerator: options.keyGenerator || defaultKeyGenerator,
    skip: options.skip || ((req) => req.user?.isAdmin === true),
    handler: options.handler || ((req, res) => {
      logger.warn(`Rate limit exceeded for ${defaultKeyGenerator(req)} on ${req.path}`);
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: options.message || 'Too many requests, please try again later.',
        },
      });
    }),
    ...options,
  });
};

// General rate limit for API endpoints (legacy alias)
const createRateLimit = (options = {}) => {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
      success: false,
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler: (req, res) => {
      logger.warn(`Rate limit exceeded for IP: ${req.ip}, endpoint: ${req.path}`);
      res.status(429).json(options.message || defaultOptions.message);
    },
    skip: (req) => {
      // Skip rate limiting for admin users
      return req.user && req.user.isAdmin;
    }
  };

  return rateLimit({ ...defaultOptions, ...options });
};

// Pre-configured limiters
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts. Please try again later.',
});

const examRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many exam operations. Please slow down.',
});

const searchRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many search requests.',
});

/**
 * Adaptive rate limiter - adjusts based on user role/status
 */
const adaptiveRateLimiter = (req, res, next) => {
  const cfg = config.rateLimit || { windowMs: 60000, max: 100 };
  let max = cfg.max;
  if (req.user?.role === 'admin') max = max * 10;
  else if (req.user?.role === 'instructor') max = max * 5;
  else if (req.user) max = max * 2;

  const limiter = createRateLimiter({ windowMs: cfg.windowMs, max });
  return limiter(req, res, next);
};

// Specific rate limits for different operations

// Rate limit for question checking (answer submission)
const checkAnswerRateLimit = createRateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 answer checks per 5 minutes
  message: {
    success: false,
    error: 'Too many answer submissions. Please wait before trying again.',
    retryAfter: '5 minutes'
  }
});

// Rate limit for getting random questions (exam generation)
const randomQuestionsRateLimit = createRateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20, // 20 random question requests per 10 minutes
  message: {
    success: false,
    error: 'Too many exam generation requests. Please wait before trying again.',
    retryAfter: '10 minutes'
  }
});

// Rate limit for search operations
const searchRateLimit = createRateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 searches per minute
  message: {
    success: false,
    error: 'Too many search requests. Please wait before searching again.',
    retryAfter: '1 minute'
  }
});

// Rate limit for question validation
const validationRateLimit = createRateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // 100 validations per 5 minutes
  message: {
    success: false,
    error: 'Too many validation requests. Please wait before trying again.',
    retryAfter: '5 minutes'
  }
});

// Rate limit for admin operations (creating/updating questions)
const adminOperationsRateLimit = createRateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 admin operations per minute
  message: {
    success: false,
    error: 'Too many admin operations. Please wait before trying again.',
    retryAfter: '1 minute'
  },
  skip: () => false // Don't skip for admin users for security
});

// Rate limit for bulk operations
const bulkOperationsRateLimit = createRateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // 5 bulk operations per 10 minutes
  message: {
    success: false,
    error: 'Too many bulk operations. Please wait before trying again.',
    retryAfter: '10 minutes'
  }
});

// Progressive rate limiting based on user behavior
const createProgressiveRateLimit = (baseLimit = 100) => {
  return (req, res, next) => {
    const userKey = req.user ? `user_${req.user.id}` : `ip_${req.ip}`;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    
    // This would typically use Redis or similar for production
    // For now, using in-memory storage (not recommended for production)
    if (!global.rateLimitStore) {
      global.rateLimitStore = new Map();
    }
    
    const userRecord = global.rateLimitStore.get(userKey) || {
      requests: [],
      violations: 0,
      lastViolation: 0
    };
    
    // Clean old requests
    userRecord.requests = userRecord.requests.filter(time => now - time < windowMs);
    
    // Calculate dynamic limit based on violations
    let currentLimit = baseLimit;
    if (userRecord.violations > 0) {
      currentLimit = Math.max(baseLimit * Math.pow(0.5, userRecord.violations), 10);
    }
    
    if (userRecord.requests.length >= currentLimit) {
      userRecord.violations++;
      userRecord.lastViolation = now;
      global.rateLimitStore.set(userKey, userRecord);
      
      logger.warn(`Progressive rate limit exceeded for ${userKey}, violations: ${userRecord.violations}`);
      
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Limit decreases with repeated violations.',
        currentLimit: currentLimit,
        violations: userRecord.violations,
        retryAfter: '15 minutes'
      });
    }
    
    userRecord.requests.push(now);
    global.rateLimitStore.set(userKey, userRecord);
    
    // Add headers
    res.set({
      'X-RateLimit-Limit': currentLimit,
      'X-RateLimit-Remaining': Math.max(0, currentLimit - userRecord.requests.length),
      'X-RateLimit-Reset': new Date(now + windowMs).toISOString()
    });
    
    next();
  };
};

// IP-based rate limiting for anonymous users
const anonymousRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per 15 minutes for anonymous users
  message: {
    success: false,
    error: 'Rate limit for anonymous users exceeded. Consider creating an account for higher limits.',
    retryAfter: '15 minutes'
  },
  skip: (req) => {
    // Skip if user is authenticated
    return req.user && req.user.id;
  }
});

// Rate limit by user ID for authenticated users
const authenticatedRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per 15 minutes for authenticated users
  keyGenerator: (req) => {
    return req.user ? `user_${req.user.id}` : req.ip;
  },
  skip: (req) => {
    // Skip if user is not authenticated (handled by anonymousRateLimit)
    return !req.user || !req.user.id;
  }
});

// Combined rate limiting middleware
const rateLimitMiddleware = (req, res, next) => {
  if (req.user && req.user.id) {
    return authenticatedRateLimit(req, res, next);
  } else {
    return anonymousRateLimit(req, res, next);
  }
};

// Clean up rate limit store periodically (for in-memory solution)
const cleanupRateLimitStore = () => {
  if (global.rateLimitStore) {
    const now = Date.now();
    const cleanupTime = 60 * 60 * 1000; // 1 hour
    
    for (const [key, record] of global.rateLimitStore.entries()) {
      // Remove records older than 1 hour
      if (record.lastViolation && (now - record.lastViolation > cleanupTime)) {
        record.violations = Math.max(0, record.violations - 1);
      }
      
      // Remove completely inactive records
      if (record.requests.length === 0 && record.violations === 0) {
        global.rateLimitStore.delete(key);
      }
    }
  }
};

// Run cleanup every 30 minutes (only in non-test environment)
let cleanupInterval = null;
if (process.env.NODE_ENV !== 'test') {
  cleanupInterval = setInterval(cleanupRateLimitStore, 30 * 60 * 1000);
}

// Allow cleanup of interval for testing
const stopCleanup = () => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
};

module.exports = {
  rateLimitMiddleware,
  checkAnswerRateLimit,
  randomQuestionsRateLimit,
  searchRateLimit,
  validationRateLimit,
  adminOperationsRateLimit,
  bulkOperationsRateLimit,
  createProgressiveRateLimit,
  createRateLimit,
  cleanupRateLimitStore,
  stopCleanup,
  // New API
  createRateLimiter,
  MemoryStoreWithCleanup,
  authRateLimiter,
  examRateLimiter,
  searchRateLimiter,
  adaptiveRateLimiter,
  defaultKeyGenerator
};