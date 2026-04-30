/**
 * @fileoverview Global Setup - Runs once before all tests
 */

module.exports = async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  
  console.log('\n🧪 Starting test suite...\n');
  
  // Store start time for performance tracking
  global.__TEST_START_TIME__ = Date.now();
  
  // Any global setup that needs to happen once
  // For example, spinning up a test database container
  
  // Note: In a real scenario, you might:
  // - Start a test database
  // - Run migrations
  // - Seed initial data
  
  console.log('✅ Global setup complete\n');
};
