/**
 * @fileoverview Database Mock for Testing
 */

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const mockPool = {
  connect: jest.fn().mockResolvedValue(mockClient),
  query: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  totalCount: 20,
  idleCount: 15,
  waitingCount: 0,
};

/**
 * Create a mock database module
 */
const createMockDatabase = () => {
  const database = {
    pool: mockPool,
    isConnecting: false,
    connectionPromise: null,

    async connect() {
      return mockPool;
    },

    async query(text, params = []) {
      return mockPool.query(text, params);
    },

    async getClient() {
      return mockClient;
    },

    async transaction(callback) {
      const client = mockClient;
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },

    async healthCheck() {
      return {
        status: 'healthy',
        latency: '5ms',
        timestamp: new Date(),
        pool: {
          total: 20,
          idle: 15,
          waiting: 0,
        },
      };
    },

    async tableExists(tableName) {
      return true;
    },

    async close() {
      return mockPool.end();
    },

    getPool() {
      return mockPool;
    },

    // Reset all mocks
    __resetMocks() {
      mockClient.query.mockReset();
      mockClient.release.mockReset();
      mockPool.connect.mockReset().mockResolvedValue(mockClient);
      mockPool.query.mockReset();
      mockPool.end.mockReset().mockResolvedValue(undefined);
    },

    // Access to mock objects for assertions
    __mockClient: mockClient,
    __mockPool: mockPool,
  };

  return database;
};

/**
 * Mock query results helpers
 */
const mockQueryResults = {
  /**
   * Create a successful query result
   */
  success(rows = [], rowCount = null) {
    return {
      rows,
      rowCount: rowCount ?? rows.length,
      command: 'SELECT',
    };
  },

  /**
   * Create an insert result
   */
  insert(rows = []) {
    return {
      rows,
      rowCount: rows.length,
      command: 'INSERT',
    };
  },

  /**
   * Create an update result
   */
  update(rowCount = 1) {
    return {
      rows: [],
      rowCount,
      command: 'UPDATE',
    };
  },

  /**
   * Create a delete result
   */
  delete(rowCount = 1) {
    return {
      rows: [],
      rowCount,
      command: 'DELETE',
    };
  },

  /**
   * Create an empty result
   */
  empty() {
    return {
      rows: [],
      rowCount: 0,
      command: 'SELECT',
    };
  },
};

/**
 * Mock PostgreSQL errors
 */
const mockPgErrors = {
  uniqueViolation(constraint = 'unique_constraint') {
    const error = new Error('duplicate key value violates unique constraint');
    error.code = '23505';
    error.constraint = constraint;
    return error;
  },

  foreignKeyViolation(constraint = 'fk_constraint') {
    const error = new Error('violates foreign key constraint');
    error.code = '23503';
    error.constraint = constraint;
    return error;
  },

  notNullViolation(column = 'column_name') {
    const error = new Error('null value in column violates not-null constraint');
    error.code = '23502';
    error.column = column;
    return error;
  },

  connectionRefused() {
    const error = new Error('Connection refused');
    error.code = 'ECONNREFUSED';
    return error;
  },

  invalidInput() {
    const error = new Error('invalid input syntax');
    error.code = '22P02';
    return error;
  },
};

module.exports = {
  createMockDatabase,
  mockQueryResults,
  mockPgErrors,
  mockClient,
  mockPool,
};
