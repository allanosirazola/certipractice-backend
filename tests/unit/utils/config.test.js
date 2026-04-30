/**
 * @fileoverview Configuration Unit Tests
 */

describe('Configuration', () => {
  let config;

  beforeAll(() => {
    // Set test environment
    process.env.NODE_ENV = 'test';
    config = require('../../../src/config/config');
  });

  describe('Structure', () => {
    it('should have server config', () => {
      expect(config.port).toBeDefined();
      expect(typeof config.port).toBe('number');
      expect(config.nodeEnv).toBeDefined();
    });

    it('should have JWT config', () => {
      expect(config.jwt).toBeDefined();
      expect(config.jwt.secret).toBeDefined();
      expect(config.jwt.expiresIn).toBeDefined();
    });

    it('should have bcrypt config', () => {
      expect(config.bcrypt).toBeDefined();
      expect(config.bcrypt.rounds).toBeDefined();
      expect(typeof config.bcrypt.rounds).toBe('number');
    });

    it('should have database config', () => {
      expect(config.database).toBeDefined();
      expect(config.database.host).toBeDefined();
      expect(config.database.port).toBeDefined();
      expect(config.database.pool).toBeDefined();
    });

    it('should have rate limit config', () => {
      expect(config.rateLimit).toBeDefined();
      expect(config.rateLimit.windowMs).toBeDefined();
      expect(config.rateLimit.max).toBeDefined();
    });

    it('should have exam config', () => {
      expect(config.exam).toBeDefined();
      expect(config.exam.minQuestions).toBeDefined();
      expect(config.exam.maxQuestions).toBeDefined();
      expect(config.exam.defaultTimeLimit).toBeDefined();
    });

    it('should have security config', () => {
      expect(config.security).toBeDefined();
      expect(config.security.maxLoginAttempts).toBeDefined();
      expect(config.security.passwordMinLength).toBeDefined();
    });

    it('should have CORS config', () => {
      expect(config.cors).toBeDefined();
      expect(config.cors.origins).toBeDefined();
      expect(Array.isArray(config.cors.origins)).toBe(true);
    });
  });

  describe('Default Values', () => {
    it('should have sensible port default', () => {
      expect(config.port).toBeGreaterThan(0);
      expect(config.port).toBeLessThan(65536);
    });

    it('should have sensible bcrypt rounds', () => {
      expect(config.bcrypt.rounds).toBeGreaterThanOrEqual(4);
      expect(config.bcrypt.rounds).toBeLessThanOrEqual(15);
    });

    it('should have sensible rate limits', () => {
      expect(config.rateLimit.max).toBeGreaterThan(0);
      expect(config.rateLimit.windowMs).toBeGreaterThan(0);
    });

    it('should have sensible exam limits', () => {
      expect(config.exam.minQuestions).toBeLessThan(config.exam.maxQuestions);
      expect(config.exam.defaultPassingScore).toBeGreaterThan(0);
      expect(config.exam.defaultPassingScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Environment Flags', () => {
    it('should detect test environment', () => {
      expect(config.isTest).toBe(true);
    });

    it('should have consistent environment flags', () => {
      // Only one should be true
      const envCount = [config.isProduction, config.isDevelopment, config.isTest]
        .filter(Boolean).length;
      expect(envCount).toBeLessThanOrEqual(1);
    });
  });

  describe('Database Pool Config', () => {
    it('should have valid pool settings', () => {
      expect(config.database.pool.max).toBeGreaterThan(0);
      expect(config.database.pool.min).toBeGreaterThanOrEqual(0);
      expect(config.database.pool.min).toBeLessThanOrEqual(config.database.pool.max);
    });

    it('should have timeout settings', () => {
      expect(config.database.pool.idleTimeoutMillis).toBeGreaterThan(0);
      expect(config.database.pool.connectionTimeoutMillis).toBeGreaterThan(0);
    });
  });

  describe('Security Config', () => {
    it('should have password requirements', () => {
      expect(config.security.passwordMinLength).toBeGreaterThanOrEqual(6);
    });

    it('should have login attempt limits', () => {
      expect(config.security.maxLoginAttempts).toBeGreaterThan(0);
      expect(config.security.lockoutTime).toBeGreaterThan(0);
    });
  });
});
