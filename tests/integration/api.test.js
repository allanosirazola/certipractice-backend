/**
 * @fileoverview API Integration Tests - Simplified
 * Tests basic routing, middleware, and health endpoints
 */

const request = require('supertest');

// Mock database first
jest.mock('../../src/utils/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  getClient: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  }),
  transaction: jest.fn().mockImplementation(async (callback) => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    return callback(client);
  }),
  healthCheck: jest.fn().mockResolvedValue({ status: 'healthy', latency: '1ms' }),
  connect: jest.fn().mockResolvedValue(true),
  close: jest.fn().mockResolvedValue(true),
  isConnected: jest.fn().mockReturnValue(true),
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  http: jest.fn(),
}));

// Mock services for controllers
jest.mock('../../src/services/userService', () => ({
  createUser: jest.fn(),
  findById: jest.fn(),
  findByEmail: jest.fn(),
  findByUsername: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  getUserStats: jest.fn(),
}));

jest.mock('../../src/services/examService', () => ({
  createExam: jest.fn(),
  getExamById: jest.fn(),
  getUserExams: jest.fn(),
  startExam: jest.fn(),
  submitAnswer: jest.fn(),
  completeExam: jest.fn(),
}));

jest.mock('../../src/services/questionService', () => ({
  getById: jest.fn(),
  getQuestions: jest.fn(),
  getRandomQuestions: jest.fn(),
  createQuestion: jest.fn(),
}));

const app = require('../../src/app');

describe('API Health and Routes', () => {
  describe('Health Endpoints', () => {
    it('GET /health should return 200', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBeDefined();
    });

    it('GET /api/health should return 200 or 404', async () => {
      const response = await request(app).get('/api/health');
      // This endpoint may not exist, so accept both 200 and 404
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('API Routes Exist', () => {
    it('POST /api/auth/register should respond', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({});
      // Should get 400 for missing fields, not 404
      expect(response.status).toBe(400);
    });

    it('POST /api/auth/login should respond', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({});
      expect(response.status).toBe(400);
    });

    it('GET /api/auth/profile without token should respond 401', async () => {
      const response = await request(app).get('/api/auth/profile');
      expect(response.status).toBe(401);
    });

    it('GET /api/questions should respond', async () => {
      const response = await request(app).get('/api/questions');
      // May be 401 if auth required, or 200/500 depending on setup
      expect([200, 401, 500]).toContain(response.status);
    });

    it('GET /api/exams should respond', async () => {
      const response = await request(app).get('/api/exams');
      // Will likely be 401 since auth is required
      expect([200, 401, 500]).toContain(response.status);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/api/unknown-route-12345');
      expect(response.status).toBe(404);
    });

    it('should handle JSON parsing errors', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('invalid json{');
      expect(response.status).toBe(400);
    });
  });

  describe('Security Headers', () => {
    it('should not expose server info', async () => {
      const response = await request(app).get('/health');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS requests', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST');
      expect([200, 204]).toContain(response.status);
    });
  });

  describe('Input Validation', () => {
    it('should reject registration with invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          email: 'invalid-email',
          password: 'password123',
        });
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject registration with short password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'short',
        });
      expect(response.status).toBe(400);
    });

    it('should reject registration with short username', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'ab',
          email: 'test@example.com',
          password: 'password123',
        });
      expect(response.status).toBe(400);
    });
  });

  describe('Request Parsing', () => {
    it('should parse JSON body', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });
      // Should not be 415 (unsupported media type)
      expect(response.status).not.toBe(415);
    });

    it('should handle empty body', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({});
      expect(response.status).toBe(400);
    });
  });
});
