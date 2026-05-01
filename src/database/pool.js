// database/pool.js
const { Pool } = require('pg');
const logger = require('../utils/logger');

class DatabasePool {
  constructor() {
    // Railway y otros servicios usan DATABASE_URL
    const connectionConfig = process.env.DATABASE_URL 
      ? {
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        }
      : {
          user: process.env.DB_USER || 'postgres',
          host: process.env.DB_HOST || 'localhost',
          database: process.env.DB_NAME || 'exam_system',
          password: process.env.DB_PASSWORD,
          port: parseInt(process.env.DB_PORT) || 5432,
        };

    this.pool = new Pool({
      ...connectionConfig,
      max: parseInt(process.env.DB_POOL_SIZE) || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected error on idle client', err);
    });

    this.pool.on('connect', () => {
      logger.debug('New client connected to database');
    });

    this.pool.on('remove', () => {
      logger.debug('Client removed from pool');
    });
  }

  async query(text, params) {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
      return result;
    } catch (error) {
      logger.error('Database query error', { text: text.substring(0, 100), error: error.message });
      throw error;
    }
  }

  async connect() {
    return await this.pool.connect();
  }

  async getClient() {
    return await this.pool.connect();
  }

  async end() {
    await this.pool.end();
    logger.info('Database pool closed');
  }

  // Helper method to execute transactions
  async transaction(callback) {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new DatabasePool();