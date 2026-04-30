/**
 * @fileoverview Test Helpers - Common utilities for testing
 */

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';

/**
 * Generate a valid JWT token for testing
 */
function generateToken(payload, options = {}) {
  const defaultPayload = {
    id: 1,
    email: 'test@test.com',
    role: 'student',
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(
    { ...defaultPayload, ...payload },
    JWT_SECRET,
    { expiresIn: '1h', ...options }
  );
}

/**
 * Generate an expired token
 */
function generateExpiredToken(payload = {}) {
  return generateToken(payload, { expiresIn: '-1s' });
}

/**
 * Generate tokens for different user roles
 */
const tokens = {
  admin: generateToken({ id: 1, email: 'admin@test.com', role: 'admin' }),
  instructor: generateToken({ id: 2, email: 'instructor@test.com', role: 'instructor' }),
  student: generateToken({ id: 3, email: 'student@test.com', role: 'student' }),
};

/**
 * Create a mock Express request object
 */
function createMockRequest(overrides = {}) {
  return {
    headers: {},
    query: {},
    params: {},
    body: {},
    cookies: {},
    user: null,
    sessionId: null,
    ip: '127.0.0.1',
    method: 'GET',
    path: '/test',
    originalUrl: '/test',
    get: jest.fn((header) => overrides.headers?.[header.toLowerCase()]),
    ...overrides,
  };
}

/**
 * Create a mock Express response object
 */
function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    cookies: {},
    body: null,
  };

  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });

  res.json = jest.fn((data) => {
    res.body = data;
    return res;
  });

  res.send = jest.fn((data) => {
    res.body = data;
    return res;
  });

  res.setHeader = jest.fn((name, value) => {
    res.headers[name.toLowerCase()] = value;
    return res;
  });

  res.set = jest.fn((name, value) => {
    if (typeof name === 'object') {
      Object.assign(res.headers, name);
    } else {
      res.headers[name.toLowerCase()] = value;
    }
    return res;
  });

  res.cookie = jest.fn((name, value, options) => {
    res.cookies[name] = { value, options };
    return res;
  });

  res.clearCookie = jest.fn((name) => {
    delete res.cookies[name];
    return res;
  });

  res.redirect = jest.fn((url) => {
    res.redirectUrl = url;
    return res;
  });

  res.end = jest.fn(() => res);

  res.headersSent = false;

  return res;
}

/**
 * Create a mock next function
 */
function createMockNext() {
  return jest.fn();
}

/**
 * Generate random test data
 */
const generators = {
  uuid: () => uuidv4(),

  email: (prefix = 'test') => `${prefix}_${Math.random().toString(36).substring(7)}@test.com`,

  username: (prefix = 'user') => `${prefix}_${Math.random().toString(36).substring(7)}`,

  password: () => `SecurePass${Math.random().toString(36).substring(7)}!`,

  integer: (min = 1, max = 1000) => Math.floor(Math.random() * (max - min + 1)) + min,

  string: (length = 10) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  },

  date: (daysFromNow = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return date;
  },

  dateString: (daysFromNow = 0) => generators.date(daysFromNow).toISOString(),
};

/**
 * Wait for a condition to be true
 */
async function waitFor(conditionFn, options = {}) {
  const { timeout = 5000, interval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await conditionFn()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Assert that an async function throws
 */
async function expectToThrow(asyncFn, expectedError) {
  let error;
  try {
    await asyncFn();
  } catch (e) {
    error = e;
  }

  expect(error).toBeDefined();

  if (typeof expectedError === 'string') {
    expect(error.message).toContain(expectedError);
  } else if (expectedError instanceof RegExp) {
    expect(error.message).toMatch(expectedError);
  } else if (typeof expectedError === 'function') {
    expect(error).toBeInstanceOf(expectedError);
  }

  return error;
}

/**
 * Create a spy that tracks all calls
 */
function createSpy(returnValue) {
  const calls = [];
  const spy = jest.fn((...args) => {
    calls.push({ args, timestamp: Date.now() });
    return typeof returnValue === 'function' ? returnValue(...args) : returnValue;
  });
  spy.getCalls = () => calls;
  spy.getLastCall = () => calls[calls.length - 1];
  return spy;
}

/**
 * Deep clone an object
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Omit specified keys from an object
 */
function omit(obj, keys) {
  const result = { ...obj };
  keys.forEach((key) => delete result[key]);
  return result;
}

/**
 * Pick specified keys from an object
 */
function pick(obj, keys) {
  const result = {};
  keys.forEach((key) => {
    if (key in obj) {
      result[key] = obj[key];
    }
  });
  return result;
}

/**
 * Assert that response has expected structure
 */
function assertSuccessResponse(response, expectedData = null) {
  expect(response.body.success).toBe(true);
  expect(response.body.error).toBeUndefined();

  if (expectedData) {
    expect(response.body.data).toEqual(expect.objectContaining(expectedData));
  } else {
    expect(response.body.data).toBeDefined();
  }
}

/**
 * Assert that response has error structure
 */
function assertErrorResponse(response, expectedStatus, expectedCode = null) {
  expect(response.status).toBe(expectedStatus);
  expect(response.body.success).toBe(false);
  expect(response.body.error).toBeDefined();

  if (expectedCode) {
    expect(response.body.error.code).toBe(expectedCode);
  }
}

/**
 * Create test suite for a model
 */
function createModelTestSuite(Model, validData, invalidDataCases) {
  describe(`${Model.name} Model`, () => {
    describe('Constructor', () => {
      it('should create instance with valid data', () => {
        const instance = new Model(validData);
        expect(instance).toBeInstanceOf(Model);
      });

      it('should create instance with default values', () => {
        const instance = new Model({});
        expect(instance).toBeInstanceOf(Model);
      });
    });

    if (Model.validate) {
      describe('validate()', () => {
        it('should return empty array for valid data', () => {
          const errors = Model.validate(validData);
          expect(errors).toEqual([]);
        });

        invalidDataCases.forEach(({ name, data, expectedError }) => {
          it(`should reject ${name}`, () => {
            const errors = Model.validate(data);
            if (expectedError) {
              expect(errors.some((e) => e.includes(expectedError))).toBe(true);
            } else {
              expect(errors.length).toBeGreaterThan(0);
            }
          });
        });
      });
    }

    if (Model.prototype.toJSON) {
      describe('toJSON()', () => {
        it('should return serializable object', () => {
          const instance = new Model(validData);
          const json = instance.toJSON();
          expect(() => JSON.stringify(json)).not.toThrow();
        });
      });
    }
  });
}

module.exports = {
  JWT_SECRET,
  generateToken,
  generateExpiredToken,
  tokens,
  createMockRequest,
  createMockResponse,
  createMockNext,
  generators,
  waitFor,
  sleep,
  expectToThrow,
  createSpy,
  deepClone,
  omit,
  pick,
  assertSuccessResponse,
  assertErrorResponse,
  createModelTestSuite,
};
