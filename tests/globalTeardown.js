/**
 * @fileoverview Global Teardown - Runs once after all tests
 */

module.exports = async () => {
  const duration = Date.now() - (global.__TEST_START_TIME__ || Date.now());
  
  console.log(`\n✅ All tests completed in ${(duration / 1000).toFixed(2)}s\n`);
  
  // Clean up any global resources
  // For example:
  // - Stop test database container
  // - Clean up temp files
  // - Close any open connections
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
};
