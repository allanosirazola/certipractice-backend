/**
 * @fileoverview Prisma Mock for Testing
 * Provides a mock Prisma client for unit tests
 */

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  question: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  questionOption: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  questionStatistics: {
    upsert: jest.fn(),
  },
  exam: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  },
  examAnswer: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  topic: {
    findMany: jest.fn(),
  },
  provider: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn((callback) => callback(mockPrisma)),
  $queryRaw: jest.fn(),
  $disconnect: jest.fn(),
};

// Reset all mocks
const resetMocks = () => {
  Object.values(mockPrisma).forEach((model) => {
    if (typeof model === 'object') {
      Object.values(model).forEach((method) => {
        if (typeof method === 'function' && method.mockReset) {
          method.mockReset();
        }
      });
    }
  });
};

module.exports = {
  mockPrisma,
  resetMocks,
};
