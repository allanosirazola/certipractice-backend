/**
 * @fileoverview Health Check Route
 * Comprehensive health checks for the application
 */

const express = require('express');
const router = express.Router();
const os = require('os');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

/**
 * Basic health check
 * GET /health
 */
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

/**
 * Detailed health check
 * GET /health/detailed
 */
router.get('/detailed', async (req, res) => {
  const startTime = Date.now();
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: {
      seconds: Math.floor(process.uptime()),
      formatted: formatUptime(process.uptime()),
    },
    system: {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpus: os.cpus().length,
      totalMemory: formatBytes(os.totalmem()),
      freeMemory: formatBytes(os.freemem()),
      loadAverage: os.loadavg(),
    },
    process: {
      pid: process.pid,
      memoryUsage: {
        heapUsed: formatBytes(process.memoryUsage().heapUsed),
        heapTotal: formatBytes(process.memoryUsage().heapTotal),
        rss: formatBytes(process.memoryUsage().rss),
        external: formatBytes(process.memoryUsage().external),
      },
    },
    checks: {},
  };

  // Database check
  try {
    const dbStartTime = Date.now();
    const prisma = require('../lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    health.checks.database = {
      status: 'OK',
      responseTime: `${Date.now() - dbStartTime}ms`,
    };
  } catch (error) {
    health.checks.database = {
      status: 'ERROR',
      error: error.message,
    };
    health.status = 'DEGRADED';
  }

  // Cache check
  try {
    const cacheStats = cache.getStats();
    health.checks.cache = {
      status: 'OK',
      keys: cacheStats.keys,
      hitRate: `${(cacheStats.hitRate * 100).toFixed(2)}%`,
    };
  } catch (error) {
    health.checks.cache = {
      status: 'ERROR',
      error: error.message,
    };
  }

  // Response time
  health.responseTime = `${Date.now() - startTime}ms`;

  const statusCode = health.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * Readiness check (for Kubernetes)
 * GET /health/ready
 */
router.get('/ready', async (req, res) => {
  try {
    const prisma = require('../lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({ status: 'not ready', error: error.message });
  }
});

/**
 * Liveness check (for Kubernetes)
 * GET /health/live
 */
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

// Helper functions
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  
  return parts.join(' ');
}

function formatBytes(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

module.exports = router;
