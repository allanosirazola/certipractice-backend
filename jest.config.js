/**
 * @fileoverview Jest Configuration
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Root directory
  rootDir: '..',
  
  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js',
  ],
  
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
    '!src/**/index.js',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  coverageReporters: ['text', 'lcov', 'html'],
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Module paths
  moduleDirectories: ['node_modules', 'src'],
  
  // Timeouts
  testTimeout: 10000,
  
  // Verbose output
  verbose: true,
  
  // Force exit after tests
  forceExit: true,
  
  // Detect open handles
  detectOpenHandles: true,
  
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  
  // Global setup/teardown
  globalSetup: '<rootDir>/tests/globalSetup.js',
  globalTeardown: '<rootDir>/tests/globalTeardown.js',
  
  // Transform ignore patterns
  transformIgnorePatterns: [
    'node_modules/(?!(uuid)/)',
  ],
  
  // Module name mapper for aliases
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
  },
};
