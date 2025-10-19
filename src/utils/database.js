const { Pool } = require('pg');
const config = require('../config/config');
const logger = require('./logger');

class Database {
  constructor() {
    this.pool = null;
    this.connecting = false;
  }

  async connect() {
    if (this.pool) {
      return this.pool;
    }

    if (this.connecting) {
      // Wait for existing connection attempt
      while (this.connecting) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.pool;
    }

    this.connecting = true;

    try {
      const poolConfig = {
        host: config.database.host,
        port: config.database.port,
        database: config.database.database,
        user: config.database.username,
        password: config.database.password,
        max: config.database.pool.max,
        min: config.database.pool.min,
        idleTimeoutMillis: config.database.pool.idle,
        connectionTimeoutMillis: config.database.pool.acquire,
        statement_timeout: 30000,
        query_timeout: 30000,
        application_name: 'exam_system',
        ...config.database.dialectOptions
      };

      this.pool = new Pool(poolConfig);

      // Test the connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      logger.info(`✅ Connected to PostgreSQL database: ${config.database.database}`);
      
      // Set up error handlers
      this.pool.on('error', (err) => {
        logger.error('PostgreSQL pool error:', err);
      });

      this.pool.on('connect', () => {
        logger.debug('New PostgreSQL client connected');
      });

      this.pool.on('remove', () => {
        logger.debug('PostgreSQL client removed from pool');
      });

      this.connecting = false;
      return this.pool;
    } catch (error) {
      this.connecting = false;
      logger.error('❌ Failed to connect to PostgreSQL:', error);
      throw error;
    }
  }

  async query(text, params = []) {
    if (!this.pool) {
      await this.connect();
    }

    const start = Date.now();
    
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      if (config.logging.level === 'debug') {
        logger.debug(`Query executed in ${duration}ms:`, {
          query: text.replace(/\s+/g, ' ').trim(),
          params: params,
          rows: result.rows?.length || 0
        });
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error(`Query failed after ${duration}ms:`, {
        query: text.replace(/\s+/g, ' ').trim(),
        params: params,
        error: error.message
      });
      throw error;
    }
  }

  async getClient() {
    if (!this.pool) {
      await this.connect();
    }
    return this.pool.connect();
  }

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

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('🔌 PostgreSQL connection pool closed');
    }
  }

  // Health check method
  async healthCheck() {
    try {
      const result = await this.query('SELECT 1 as health_check, NOW() as timestamp');
      return {
        status: 'healthy',
        timestamp: result.rows[0].timestamp,
        connections: {
          total: this.pool?.totalCount || 0,
          idle: this.pool?.idleCount || 0,
          waiting: this.pool?.waitingCount || 0
        }
      };
    } catch (error) {
      logger.error('Database health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        connections: {
          total: this.pool?.totalCount || 0,
          idle: this.pool?.idleCount || 0,
          waiting: this.pool?.waitingCount || 0
        }
      };
    }
  }

  // Helper method to check if database exists
  async databaseExists(dbName) {
    try {
      const result = await this.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [dbName]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error checking if database exists:', error);
      return false;
    }
  }

  // Helper method to check if table exists
  async tableExists(tableName) {
    try {
      const result = await this.query(
        `SELECT 1 FROM information_schema.tables 
         WHERE table_schema = 'public' AND table_name = $1`,
        [tableName]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error checking if table exists:', error);
      return false;
    }
  }

  // Get database schema information
  async getSchemaInfo() {
    try {
      const tablesQuery = `
        SELECT table_name, table_type 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
      `;
      
      const enumsQuery = `
        SELECT t.typname as enum_name,
               array_agg(e.enumlabel ORDER BY e.enumsortorder) as enum_values
        FROM pg_type t 
        JOIN pg_enum e ON t.oid = e.enumtypid  
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        GROUP BY t.typname
        ORDER BY t.typname
      `;

      const [tablesResult, enumsResult] = await Promise.all([
        this.query(tablesQuery),
        this.query(enumsQuery)
      ]);

      return {
        tables: tablesResult.rows,
        enums: enumsResult.rows,
        connectionInfo: await this.healthCheck()
      };
    } catch (error) {
      logger.error('Error getting schema info:', error);
      throw error;
    }
  }
}

// Create singleton instance
const database = new Database();

// Graceful shutdown
process.on('SIGINT', async () => {
  await database.close();
});

process.on('SIGTERM', async () => {
  await database.close();
});

module.exports = database;