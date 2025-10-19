// src/middleware/rateLimit.js - Rate limiting middleware
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// General rate limit for API endpoints
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

// Run cleanup every 30 minutes
setInterval(cleanupRateLimitStore, 30 * 60 * 1000);

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
  cleanupRateLimitStore
};