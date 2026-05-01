const app = require('./app');
const config = require('./config/config');
const logger = require('./utils/logger');

const PORT = config.port || 3000;

// Función para verificar conexión a base de datos
const checkDatabaseConnection = async () => {
  try {
    // Intenta usar el pool de pg directamente (más confiable que Prisma en startup)
    const pool = require('./database/pool');
    await pool.query('SELECT 1');
    logger.info('✅ Database connection verified');
    return true;
  } catch (error) {
    logger.warn(`⚠️ Database not available: ${error.message}`);
    return false;
  }
};

// Iniciar servidor
const startServer = async () => {
  // Verificar DB pero no fallar si no está disponible
  await checkDatabaseConnection();

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Server running on port ${PORT} in ${config.nodeEnv} mode`);
    logger.info(`📍 Health check available at /health`);
  });

  // Configurar timeouts para Railway
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  // Graceful shutdown
  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Forzar cierre después de 10s
    setTimeout(() => {
      logger.warn('Forcing shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Capturar errores no manejados
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // En producción, permitir que el proceso continúe si es posible
    if (config.nodeEnv !== 'production') {
      process.exit(1);
    }
  });

  return server;
};

startServer().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = startServer;
