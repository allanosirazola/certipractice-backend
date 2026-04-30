/**
 * @fileoverview Rate Limit Middleware Unit Tests
 */

const {
  createRateLimiter,
  MemoryStoreWithCleanup,
  authRateLimiter,
  examRateLimiter,
  searchRateLimiter,
  adaptiveRateLimiter,
} = require('../../../src/middleware/rateLimit');

// Mock config
jest.mock('../../../src/config/config', () => ({
  rateLimit: {
    windowMs: 60000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  },
  isProduction: false,
  isDevelopment: true,
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('Rate Limit Middleware', () => {
  describe('MemoryStoreWithCleanup', () => {
    let store;

    beforeEach(() => {
      store = new MemoryStoreWithCleanup(60000);
    });

    afterEach(() => {
      store.shutdown();
    });

    it('should initialize with empty state', () => {
      expect(store.hits.size).toBe(0);
    });

    it('should increment hit count', () => {
      const result1 = store.increment('key1');
      expect(result1.totalHits).toBe(1);

      const result2 = store.increment('key1');
      expect(result2.totalHits).toBe(2);
    });

    it('should track different keys separately', () => {
      store.increment('key1');
      store.increment('key1');
      store.increment('key2');

      const result1 = store.increment('key1');
      const result2 = store.increment('key2');

      expect(result1.totalHits).toBe(3);
      expect(result2.totalHits).toBe(2);
    });

    it('should reset key', () => {
      store.increment('key1');
      store.increment('key1');
      store.resetKey('key1');
      
      const result = store.increment('key1');
      expect(result.totalHits).toBe(1);
    });

    it('should return reset time', () => {
      const result = store.increment('key1');
      expect(result.resetTime).toBeInstanceOf(Date);
      expect(result.resetTime.getTime()).toBeGreaterThan(Date.now());
    });

    it('should shutdown cleanly', () => {
      store.increment('key1');
      store.shutdown();
      expect(store.hits.size).toBe(0);
    });
  });

  describe('createRateLimiter()', () => {
    it('should create rate limiter with default options', () => {
      const limiter = createRateLimiter();
      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe('function');
    });

    it('should create rate limiter with custom options', () => {
      const limiter = createRateLimiter({ windowMs: 30000, max: 50 });
      expect(limiter).toBeDefined();
    });
  });

  describe('Pre-configured Rate Limiters', () => {
    it('authRateLimiter should be defined', () => {
      expect(authRateLimiter).toBeDefined();
      expect(typeof authRateLimiter).toBe('function');
    });

    it('examRateLimiter should be defined', () => {
      expect(examRateLimiter).toBeDefined();
      expect(typeof examRateLimiter).toBe('function');
    });

    it('searchRateLimiter should be defined', () => {
      expect(searchRateLimiter).toBeDefined();
      expect(typeof searchRateLimiter).toBe('function');
    });

    it('adaptiveRateLimiter should be defined', () => {
      expect(adaptiveRateLimiter).toBeDefined();
      expect(typeof adaptiveRateLimiter).toBe('function');
    });
  });

  describe('Key Generation Logic', () => {
    it('should generate correct keys', () => {
      const keyGen = (req) => {
        if (req.user?.id) return `user:${req.user.id}`;
        if (req.sessionId) return `session:${req.sessionId}`;
        return `ip:${req.ip}`;
      };

      expect(keyGen({ user: { id: 123 }, ip: '1.1.1.1' })).toBe('user:123');
      expect(keyGen({ sessionId: 'abc', ip: '1.1.1.1' })).toBe('session:abc');
      expect(keyGen({ ip: '1.1.1.1' })).toBe('ip:1.1.1.1');
    });
  });
});
