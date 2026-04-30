/**
 * @fileoverview Jest Setup - Runs before each test file
 */

// Set test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce noise in tests

// Mock environment variables
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'exam_system_test';
process.env.DB_USER = 'postgres';
process.env.DB_PASSWORD = 'test_password';
process.env.BCRYPT_ROUNDS = '4'; // Faster for tests

// Extend Jest matchers
expect.extend({
  toBeValidUUID(received) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);
    return {
      pass,
      message: () => `expected ${received} ${pass ? 'not ' : ''}to be a valid UUID v4`,
    };
  },

  toBeWithinRange(received, floor, ceiling) {
    const pass = received >= floor && received <= ceiling;
    return {
      pass,
      message: () =>
        `expected ${received} ${pass ? 'not ' : ''}to be within range ${floor} - ${ceiling}`,
    };
  },

  toHaveBeenCalledWithMatch(received, ...expectedArgs) {
    const calls = received.mock.calls;
    const pass = calls.some((call) =>
      expectedArgs.every((arg, index) => {
        if (typeof arg === 'object') {
          return expect.objectContaining(arg).asymmetricMatch(call[index]);
        }
        return call[index] === arg;
      })
    );
    return {
      pass,
      message: () =>
        `expected mock ${pass ? 'not ' : ''}to have been called with matching arguments`,
    };
  },
});

// Global test utilities
global.testUtils = {
  /**
   * Wait for a condition to be true
   */
  async waitFor(condition, timeout = 5000, interval = 100) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error('Condition not met within timeout');
  },

  /**
   * Generate random string
   */
  randomString(length = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  /**
   * Generate test email
   */
  randomEmail() {
    return `test_${this.randomString(8)}@test.com`;
  },

  /**
   * Sleep for ms
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

// Suppress console during tests (optional)
if (process.env.SUPPRESS_CONSOLE !== 'false') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    // Keep warn and error for debugging
    warn: console.warn,
    error: console.error,
  };
}

// Handle unhandled rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in test:', reason);
});

// Increase timeout for CI environments
if (process.env.CI) {
  jest.setTimeout(30000);
}

// Clean up after all tests
afterAll(async () => {
  // Clean up any global resources
  await new Promise((resolve) => setTimeout(resolve, 100));
});
