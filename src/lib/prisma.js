/**
 * @fileoverview Prisma Client Singleton
 * Ensures a single instance of Prisma Client is used across the application
 */

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = globalThis;

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'error', emit: 'stdout' },
      { level: 'info', emit: 'stdout' },
      { level: 'warn', emit: 'stdout' },
    ],
  });
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

// Log queries in development
if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query', (e) => {
    logger.debug('Prisma Query', {
      query: e.query,
      params: e.params,
      duration: `${e.duration}ms`,
    });
  });
}

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Disconnecting Prisma Client...');
  await prisma.$disconnect();
  logger.info('Prisma Client disconnected');
};

process.on('beforeExit', gracefulShutdown);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
