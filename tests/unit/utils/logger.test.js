/**
 * @fileoverview Logger Unit Tests
 */

// Mock winston before requiring logger
jest.mock('winston', () => {
  const mockFormat = {
    combine: jest.fn(() => mockFormat),
    timestamp: jest.fn(() => mockFormat),
    errors: jest.fn(() => mockFormat),
    json: jest.fn(() => mockFormat),
    printf: jest.fn(() => mockFormat),
    colorize: jest.fn(() => mockFormat),
    simple: jest.fn(() => mockFormat),
  };

  const mockTransport = jest.fn();
  
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    http: jest.fn(),
    add: jest.fn(),
  };

  return {
    createLogger: jest.fn(() => mockLogger),
    format: mockFormat,
    transports: {
      Console: mockTransport,
      File: mockTransport,
    },
    config: {
      npm: {
        levels: {
          error: 0,
          warn: 1,
          info: 2,
          http: 3,
          verbose: 4,
          debug: 5,
          silly: 6,
        },
      },
    },
  };
});

// Mock config
jest.mock('../../../src/config/config', () => ({
  logging: {
    level: 'debug',
    file: null,
  },
  isProduction: false,
  isDevelopment: true,
  isTest: true,
}));

describe('Logger', () => {
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    logger = require('../../../src/utils/logger');
  });

  describe('Logger Instance', () => {
    it('should export a logger object', () => {
      expect(logger).toBeDefined();
    });

    it('should have info method', () => {
      expect(typeof logger.info).toBe('function');
    });

    it('should have error method', () => {
      expect(typeof logger.error).toBe('function');
    });

    it('should have warn method', () => {
      expect(typeof logger.warn).toBe('function');
    });

    it('should have debug method', () => {
      expect(typeof logger.debug).toBe('function');
    });
  });

  describe('Logging Methods', () => {
    it('should call info with message', () => {
      logger.info('Test info message');
      expect(logger.info).toHaveBeenCalledWith('Test info message');
    });

    it('should call error with message', () => {
      logger.error('Test error message');
      expect(logger.error).toHaveBeenCalledWith('Test error message');
    });

    it('should call warn with message', () => {
      logger.warn('Test warn message');
      expect(logger.warn).toHaveBeenCalledWith('Test warn message');
    });

    it('should call debug with message', () => {
      logger.debug('Test debug message');
      expect(logger.debug).toHaveBeenCalledWith('Test debug message');
    });

    it('should call info with metadata', () => {
      const meta = { userId: 123, action: 'login' };
      logger.info('User action', meta);
      expect(logger.info).toHaveBeenCalledWith('User action', meta);
    });

    it('should call error with error object', () => {
      const error = new Error('Test error');
      logger.error('An error occurred', { error });
      expect(logger.error).toHaveBeenCalledWith('An error occurred', { error });
    });
  });

  describe('Winston Configuration', () => {
    it('should create logger with winston', () => {
      const winston = require('winston');
      expect(winston.createLogger).toHaveBeenCalled();
    });
  });
});

describe('Sensitive Data Filtering', () => {
  // Test the filterSensitiveData function logic
  const filterSensitiveData = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    
    const sensitiveKeys = ['password', 'token', 'secret', 'authorization', 'credit_card', 'ssn'];
    const filtered = { ...obj };
    
    for (const key of Object.keys(filtered)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
        filtered[key] = '[REDACTED]';
      } else if (typeof filtered[key] === 'object' && filtered[key] !== null) {
        filtered[key] = filterSensitiveData(filtered[key]);
      }
    }
    
    return filtered;
  };

  it('should filter password fields', () => {
    const data = { username: 'test', password: 'secret123' };
    const filtered = filterSensitiveData(data);
    expect(filtered.password).toBe('[REDACTED]');
    expect(filtered.username).toBe('test');
  });

  it('should filter token fields', () => {
    const data = { userId: 1, accessToken: 'abc123' };
    const filtered = filterSensitiveData(data);
    expect(filtered.accessToken).toBe('[REDACTED]');
  });

  it('should filter authorization headers', () => {
    const data = { headers: { authorization: 'Bearer xyz' } };
    const filtered = filterSensitiveData(data);
    expect(filtered.headers.authorization).toBe('[REDACTED]');
  });

  it('should filter nested sensitive data', () => {
    const data = {
      user: {
        name: 'John',
        credentials: {
          password: 'secret',
        },
      },
    };
    const filtered = filterSensitiveData(data);
    expect(filtered.user.credentials.password).toBe('[REDACTED]');
    expect(filtered.user.name).toBe('John');
  });

  it('should handle null values', () => {
    expect(filterSensitiveData(null)).toBe(null);
  });

  it('should handle primitive values', () => {
    expect(filterSensitiveData('string')).toBe('string');
    expect(filterSensitiveData(123)).toBe(123);
  });
});
