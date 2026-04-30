/**
 * @fileoverview Services Index
 * Central export point for all services
 * 
 * Set USE_PRISMA=true to use Prisma-based services (recommended for new deployments)
 * Set USE_PRISMA=false to use legacy SQL-based services (for backwards compatibility)
 */

const usePrisma = process.env.USE_PRISMA === 'true';

// Export appropriate service implementations based on configuration
let examService;
let questionService;
let userService;

if (usePrisma) {
  // Prisma-based services (new implementation)
  examService = require('./examServicePrisma');
  // These will be added as we migrate them
  // questionService = require('./questionServicePrisma');
  // userService = require('./userServicePrisma');
  
  // For now, fall back to legacy for services not yet migrated
  questionService = require('./questionService');
  userService = require('./userService');
  
  console.log('📦 Using Prisma-based services');
} else {
  // Legacy SQL-based services
  examService = require('./examService');
  questionService = require('./questionService');
  userService = require('./userService');
  
  console.log('📦 Using legacy SQL-based services');
}

module.exports = {
  examService,
  questionService,
  userService,
  
  // Also export as named exports
  ExamService: examService,
  QuestionService: questionService,
  UserService: userService,
};
