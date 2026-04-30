/**
 * @fileoverview Cache Service
 * In-memory caching with TTL support for frequently accessed data
 */

const NodeCache = require('node-cache');
const logger = require('./logger');

class CacheService {
  constructor(options = {}) {
    this.cache = new NodeCache({
      stdTTL: options.ttl || 300, // 5 minutes default
      checkperiod: options.checkperiod || 60,
      useClones: false, // Better performance
      deleteOnExpire: true,
    });

    // Cache statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
    };

    // Listen for events
    this.cache.on('expired', (key, value) => {
      logger.debug(`Cache key expired: ${key}`);
    });

    this.cache.on('del', (key, value) => {
      logger.debug(`Cache key deleted: ${key}`);
    });
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined
   */
  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.stats.hits++;
      logger.debug(`Cache hit: ${key}`);
      return value;
    }
    this.stats.misses++;
    logger.debug(`Cache miss: ${key}`);
    return undefined;
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - TTL in seconds (optional)
   * @returns {boolean} Success status
   */
  set(key, value, ttl) {
    this.stats.sets++;
    if (ttl) {
      return this.cache.set(key, value, ttl);
    }
    return this.cache.set(key, value);
  }

  /**
   * Delete key from cache
   * @param {string} key - Cache key
   * @returns {number} Number of deleted keys
   */
  del(key) {
    return this.cache.del(key);
  }

  /**
   * Delete multiple keys by pattern
   * @param {string} pattern - Key pattern (prefix)
   * @returns {number} Number of deleted keys
   */
  delByPattern(pattern) {
    const keys = this.cache.keys().filter(k => k.startsWith(pattern));
    return this.cache.del(keys);
  }

  /**
   * Check if key exists
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Get or set value (cache-aside pattern)
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Function to fetch data if not cached
   * @param {number} ttl - TTL in seconds (optional)
   * @returns {Promise<*>} Cached or fetched value
   */
  async getOrSet(key, fetchFn, ttl) {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await fetchFn();
    if (value !== undefined && value !== null) {
      this.set(key, value, ttl);
    }
    return value;
  }

  /**
   * Flush all cache
   */
  flush() {
    this.cache.flushAll();
    logger.info('Cache flushed');
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    const cacheStats = this.cache.getStats();
    return {
      ...this.stats,
      keys: cacheStats.keys,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: cacheStats.hits / (cacheStats.hits + cacheStats.misses) || 0,
    };
  }

  /**
   * Get all keys
   * @returns {string[]} Array of keys
   */
  keys() {
    return this.cache.keys();
  }
}

// Cache key generators
const cacheKeys = {
  user: (id) => `user:${id}`,
  userByEmail: (email) => `user:email:${email.toLowerCase()}`,
  question: (id) => `question:${id}`,
  questions: (filters) => `questions:${JSON.stringify(filters)}`,
  exam: (id) => `exam:${id}`,
  examQuestions: (examId) => `exam:${examId}:questions`,
  certification: (id) => `certification:${id}`,
  certifications: () => 'certifications:all',
  providers: () => 'providers:all',
  topics: (certId) => `topics:cert:${certId}`,
  userStats: (userId) => `user:${userId}:stats`,
  questionStats: (questionId) => `question:${questionId}:stats`,
};

// Cache TTL constants (in seconds)
const cacheTTL = {
  SHORT: 60,        // 1 minute
  MEDIUM: 300,      // 5 minutes
  LONG: 900,        // 15 minutes
  HOUR: 3600,       // 1 hour
  DAY: 86400,       // 24 hours
};

// Create singleton instance
const cacheService = new CacheService({
  ttl: cacheTTL.MEDIUM,
});

module.exports = cacheService;
module.exports.CacheService = CacheService;
module.exports.cacheKeys = cacheKeys;
module.exports.cacheTTL = cacheTTL;
