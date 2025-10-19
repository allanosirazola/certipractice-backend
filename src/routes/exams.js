// routes/exams.js - ACTUALIZADO para PostgreSQL
const express = require('express');
const {
  createExam,
  createFailedQuestionsExam,
  getUserExams,
  getExamById,
  startExam,
  submitAnswer,
  completeExam,
  getExamResults,
  deleteExam,
  getExamProgress,
  validateAnswer,
  getExamStatistics,
  pauseExam,
  resumeExam,
  getExamForReview 
} = require('../controllers/examController');
const { auth, optionalAuth } = require('../middleware/auth');
const { validateExamAccess } = require('../middleware/examMiddleware');

const router = express.Router();

// Middleware para validar acceso a exámenes (si existe)
// router.use('/:id', validateExamAccess);

// === RUTAS PRINCIPALES ===

// Crear nuevo examen
router.post('/', optionalAuth, createExam);

// NEW: Crear examen de preguntas fallidas (requiere autenticación)
router.post('/failed-questions', auth, createFailedQuestionsExam);

// Obtener lista de exámenes del usuario/sesión
router.get('/', optionalAuth, getUserExams);

// Obtener examen específico por ID
router.get('/:id', optionalAuth, getExamById);

// Obtener examen completo para revisión (incluye respuestas correctas)
router.get('/:id/review', optionalAuth, getExamForReview);

// === RUTAS DE GESTIÓN DEL EXAMEN ===

// Iniciar examen
router.post('/:id/start', optionalAuth, startExam);

// Pausar examen
router.post('/:id/pause', optionalAuth, pauseExam);

// Reanudar examen pausado
router.post('/:id/resume', optionalAuth, resumeExam);

// Enviar respuesta a una pregunta
router.post('/:id/answer', optionalAuth, submitAnswer);

// Completar examen
router.post('/:id/complete', optionalAuth, completeExam);

// === RUTAS DE INFORMACIÓN Y ANÁLISIS ===

// Obtener progreso del examen
router.get('/:id/progress', optionalAuth, getExamProgress);

// Obtener resultados del examen completado
router.get('/:id/results', optionalAuth, getExamResults);

// Obtener estadísticas detalladas del examen (NUEVO)
router.get('/:id/statistics', optionalAuth, getExamStatistics);

// === RUTAS DE UTILIDAD ===

// Validar respuesta antes de enviar
router.post('/:id/validate-answer', optionalAuth, validateAnswer);

// Eliminar examen
router.delete('/:id', optionalAuth, deleteExam);

// === MIDDLEWARE DE MANEJO DE ERRORES ===
router.use((error, req, res, next) => {
  console.error('Exam route error:', error);
  
  // Errores específicos de PostgreSQL
  if (error.code === '23505') { // Unique violation
    return res.status(409).json({
      success: false,
      error: 'Duplicate entry detected',
      code: 'DUPLICATE_ENTRY'
    });
  }
  
  if (error.code === '23503') { // Foreign key violation
    return res.status(400).json({
      success: false,
      error: 'Invalid reference in request',
      code: 'INVALID_REFERENCE'
    });
  }
  
  if (error.code === '23514') { // Check violation
    return res.status(400).json({
      success: false,
      error: 'Data validation failed',
      code: 'VALIDATION_ERROR'
    });
  }
  
  // Error de conexión a la base de datos
  if (error.code === 'ECONNREFUSED') {
    return res.status(503).json({
      success: false,
      error: 'Database connection error',
      code: 'DB_CONNECTION_ERROR'
    });
  }
  
  // Error genérico
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});

module.exports = router;