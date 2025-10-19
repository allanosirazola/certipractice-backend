// middleware/examMiddleware.js - Middleware específico para exámenes
const ExamService = require('../services/examService');
const logger = require('../utils/logger');

/**
 * Middleware para validar acceso a exámenes
 */
const validateExamAccess = async (req, res, next) => {
  try {
    const examId = req.params.id;
    const userId = req.user ? req.user.id : null;
    const sessionId = req.sessionId || null;

    if (!examId) {
      return res.status(400).json({
        success: false,
        error: 'Exam ID is required'
      });
    }

    // Validar formato UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(examId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid exam ID format'
      });
    }

    // Verificar que el examen existe
    const exam = await ExamService.getExamById(examId, userId, sessionId);
    if (!exam) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    // Verificar autorización
    if (!exam.belongsTo(userId, sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this exam'
      });
    }

    // Agregar el examen al request para uso posterior
    req.exam = exam;
    next();
  } catch (error) {
    logger.error('Exam access validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error validating exam access'
    });
  }
};

/**
 * Middleware para validar estado del examen
 */
const validateExamStatus = (allowedStatuses) => {
  return (req, res, next) => {
    try {
      const exam = req.exam;
      if (!exam) {
        return res.status(400).json({
          success: false,
          error: 'Exam not loaded in request'
        });
      }

      if (!allowedStatuses.includes(exam.status)) {
        return res.status(400).json({
          success: false,
          error: `Operation not allowed. Exam status: ${exam.status}. Required: ${allowedStatuses.join(', ')}`
        });
      }

      next();
    } catch (error) {
      logger.error('Exam status validation error:', error);
      res.status(500).json({
        success: false,
        error: 'Server error validating exam status'
      });
    }
  };
};

/**
 * Middleware para verificar tiempo de examen
 */
const validateExamTime = (req, res, next) => {
  try {
    const exam = req.exam;
    if (!exam) {
      return res.status(400).json({
        success: false,
        error: 'Exam not loaded in request'
      });
    }

    // Solo verificar tiempo para exámenes en progreso
    if (exam.status === 'in_progress' && exam.isTimeExpired()) {
      return res.status(400).json({
        success: false,
        error: 'Exam time has expired',
        code: 'TIME_EXPIRED',
        data: {
          timeLimit: exam.timeLimit,
          timeSpent: exam.timeSpent,
          expiredAt: new Date().toISOString()
        }
      });
    }

    next();
  } catch (error) {
    logger.error('Exam time validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error validating exam time'
    });
  }
};

/**
 * Middleware para validar datos de respuesta
 */
const validateAnswerData = (req, res, next) => {
  try {
    const { questionId, answer } = req.body;

    if (!questionId) {
      return res.status(400).json({
        success: false,
        error: 'Question ID is required'
      });
    }

    if (answer === undefined || answer === null) {
      return res.status(400).json({
        success: false,
        error: 'Answer is required'
      });
    }

    // Validar formato de questionId (debe ser entero)
    if (!Number.isInteger(questionId) || questionId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Question ID must be a positive integer'
      });
    }

    // Validar formato de respuesta
    if (Array.isArray(answer)) {
      // Respuesta múltiple
      if (answer.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'At least one answer must be selected'
        });
      }

      // Validar que todos los elementos sean números
      if (!answer.every(item => Number.isInteger(item) && item >= 0)) {
        return res.status(400).json({
          success: false,
          error: 'All answer indices must be non-negative integers'
        });
      }

      // Eliminar duplicados
      const uniqueAnswers = [...new Set(answer)];
      if (uniqueAnswers.length !== answer.length) {
        req.body.answer = uniqueAnswers;
        logger.warn('Removed duplicate answers:', {
          original: answer,
          cleaned: uniqueAnswers
        });
      }
    } else {
      // Respuesta única
      if (!Number.isInteger(answer) || answer < 0) {
        return res.status(400).json({
          success: false,
          error: 'Answer must be a non-negative integer'
        });
      }
    }

    next();
  } catch (error) {
    logger.error('Answer validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error validating answer data'
    });
  }
};

/**
 * Middleware para limitar intentos de respuesta
 */
const rateLimitAnswers = (maxAttemptsPerMinute = 30) => {
  const attempts = new Map();

  return (req, res, next) => {
    try {
      const identifier = req.user ? `user_${req.user.id}` : `session_${req.sessionId}`;
      const now = Date.now();
      const windowStart = now - 60000; // 1 minuto

      // Limpiar intentos antiguos
      if (attempts.has(identifier)) {
        const userAttempts = attempts.get(identifier).filter(time => time > windowStart);
        attempts.set(identifier, userAttempts);
      }

      // Verificar límite
      const currentAttempts = attempts.get(identifier) || [];
      if (currentAttempts.length >= maxAttemptsPerMinute) {
        return res.status(429).json({
          success: false,
          error: 'Too many answer submissions. Please wait before trying again.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: 60
        });
      }

      // Registrar intento actual
      currentAttempts.push(now);
      attempts.set(identifier, currentAttempts);

      next();
    } catch (error) {
      logger.error('Rate limit error:', error);
      next(); // Continuar en caso de error en el rate limiting
    }
  };
};

/**
 * Middleware para validar permisos según el tipo de usuario
 */
const validateUserPermissions = (requiredPermissions = []) => {
  return (req, res, next) => {
    try {
      const user = req.user;
      
      // Si no hay usuario autenticado pero se requieren permisos específicos
      if (!user && requiredPermissions.length > 0) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required for this operation'
        });
      }

      // Verificar permisos específicos para usuarios autenticados
      if (user && requiredPermissions.length > 0) {
        const userRole = user.role || 'student';
        const hasPermission = requiredPermissions.some(permission => {
          switch (permission) {
            case 'admin':
              return userRole === 'admin';
            case 'instructor':
              return ['admin', 'instructor'].includes(userRole);
            case 'student':
              return ['admin', 'instructor', 'student'].includes(userRole);
            default:
              return false;
          }
        });

        if (!hasPermission) {
          return res.status(403).json({
            success: false,
            error: 'Insufficient permissions for this operation'
          });
        }
      }

      next();
    } catch (error) {
      logger.error('User permissions validation error:', error);
      res.status(500).json({
        success: false,
        error: 'Server error validating user permissions'
      });
    }
  };
};

/**
 * Middleware para logging de actividad de exámenes
 */
const logExamActivity = (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    // Log de la actividad
    logger.info('Exam activity:', {
      method: req.method,
      url: req.originalUrl,
      examId: req.params.id,
      userId: req.user ? req.user.id : null,
      sessionId: req.sessionId,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      statusCode: res.statusCode,
      responseTime: Date.now() - req.startTime
    });

    originalSend.call(this, data);
  };

  req.startTime = Date.now();
  next();
};

/**
 * Middleware para validar configuración de examen
 */
const validateExamConfiguration = (req, res, next) => {
  try {
    const examData = req.body;

    // Validaciones específicas de negocio
    if (examData.questionCount && examData.questionCount > 200) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 200 questions allowed per exam'
      });
    }

    if (examData.timeLimit && examData.timeLimit > 480) { // 8 horas máximo
      return res.status(400).json({
        success: false,
        error: 'Maximum time limit is 480 minutes (8 hours)'
      });
    }

    if (examData.passingScore && (examData.passingScore < 0 || examData.passingScore > 100)) {
      return res.status(400).json({
        success: false,
        error: 'Passing score must be between 0 and 100'
      });
    }

    next();
  } catch (error) {
    logger.error('Exam configuration validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error validating exam configuration'
    });
  }
};

module.exports = {
  validateExamAccess,
  validateExamStatus,
  validateExamTime,
  validateAnswerData,
  rateLimitAnswers,
  validateUserPermissions,
  logExamActivity,
  validateExamConfiguration
};