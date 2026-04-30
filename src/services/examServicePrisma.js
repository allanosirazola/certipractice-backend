/**
 * @fileoverview Exam Service (Prisma Version)
 * Business logic for exam operations using Prisma repositories
 */

const { examRepository, questionRepository, userRepository } = require('../repositories');
const Exam = require('../models/Exam');
const logger = require('../utils/logger');
const cache = require('../utils/cache');
const { cacheKeys, cacheTTL } = require('../utils/cache');
const {
  NotFoundError,
  BusinessError,
  ExamNotStartedError,
  ExamAlreadyCompletedError,
  ExamTimeExpiredError,
  InsufficientQuestionsError,
  ForbiddenError,
} = require('../utils/errors');

class ExamServicePrisma {
  /**
   * Create a new exam
   * @param {Object} examConfig - Exam configuration
   * @param {number|null} userId - User ID (null for anonymous)
   * @param {string|null} sessionId - Session ID (for anonymous users)
   * @returns {Promise<Exam>} Created exam instance
   */
  async createExam(examConfig, userId = null, sessionId = null) {
    logger.info('Creating exam', { userId, sessionId, config: examConfig });

    // Validate that we have either userId or sessionId
    if (!userId && !sessionId) {
      throw new BusinessError('Either userId or sessionId is required');
    }

    // For anonymous users, create or get temporary user
    let finalUserId = userId;
    if (!userId && sessionId) {
      finalUserId = await this._getOrCreateTempUser(sessionId);
    }

    // Get certification details
    const certification = await this._getCertification(
      examConfig.provider,
      examConfig.certification
    );

    // Determine question count
    const questionCount = examConfig.questionCount || certification.totalQuestions || 10;

    // Get random questions
    const questions = await questionRepository.findRandom({
      count: questionCount,
      certificationId: certification.id,
      topicIds: examConfig.category ? [examConfig.category] : undefined,
      difficulty: examConfig.difficulty,
    });

    if (questions.length < 5) {
      throw new InsufficientQuestionsError(questions.length, 5);
    }

    // Create exam with questions
    const examData = {
      userId: finalUserId,
      sessionId,
      certificationId: certification.id,
      title: `${certification.provider.name} ${certification.name} - ${this._getModeLabel(examConfig.mode)}`,
      mode: examConfig.mode || 'practice',
      questionCount: questions.length,
      timeLimit: examConfig.timeLimit || certification.durationMinutes || 120,
      passingScore: certification.passingScore || 70,
      settings: {
        randomizeQuestions: examConfig.settings?.randomizeQuestions !== false,
        randomizeAnswers: examConfig.settings?.randomizeAnswers === true,
        showExplanations: examConfig.mode === 'practice',
        allowPause: examConfig.mode === 'practice',
        allowReview: examConfig.mode === 'practice',
        ...examConfig.settings,
      },
    };

    const questionIds = questions.map(q => q.id);
    const exam = await examRepository.create(examData, questionIds);

    logger.info('Exam created successfully', { examId: exam.id, questionCount: questions.length });

    return this._toExamModel(exam, questions);
  }

  /**
   * Get exam by ID
   * @param {string} examId - Exam UUID
   * @param {number|null} userId - User ID for authorization
   * @param {string|null} sessionId - Session ID for authorization
   * @returns {Promise<Exam|null>} Exam instance or null
   */
  async getExamById(examId, userId = null, sessionId = null) {
    // Try cache first
    const cacheKey = cacheKeys.exam(examId);
    const cached = cache.get(cacheKey);
    if (cached) {
      const exam = this._toExamModel(cached.exam, cached.questions);
      if (this._checkAccess(exam, userId, sessionId)) {
        return exam;
      }
    }

    const examData = await examRepository.findById(examId, true);
    if (!examData) {
      return null;
    }

    // Cache for future requests
    cache.set(cacheKey, { exam: examData, questions: examData.answers }, cacheTTL.SHORT);

    return this._toExamModel(examData);
  }

  /**
   * Start an exam
   * @param {string} examId - Exam UUID
   * @param {number|null} userId - User ID
   * @param {string|null} sessionId - Session ID
   * @returns {Promise<Exam>} Updated exam
   */
  async startExam(examId, userId = null, sessionId = null) {
    const exam = await this.getExamById(examId, userId, sessionId);
    
    if (!exam) {
      throw new NotFoundError('Exam');
    }

    if (!this._checkAccess(exam, userId, sessionId)) {
      throw new ForbiddenError('Unauthorized to access this exam');
    }

    if (exam.status !== 'pending' && exam.status !== 'not_started') {
      throw new BusinessError(`Exam cannot be started. Current status: ${exam.status}`);
    }

    const startedExam = await examRepository.start(examId);
    
    // Invalidate cache
    cache.del(cacheKeys.exam(examId));

    logger.info('Exam started', { examId, userId, sessionId });

    return this._toExamModel(startedExam);
  }

  /**
   * Submit an answer
   * @param {string} examId - Exam UUID
   * @param {string} questionId - Question UUID
   * @param {number|number[]} answer - Answer index(es)
   * @param {number|null} userId - User ID
   * @param {string|null} sessionId - Session ID
   * @param {number} timeSpent - Time spent in seconds
   * @returns {Promise<Object>} Submission result
   */
  async submitAnswer(examId, questionId, answer, userId = null, sessionId = null, timeSpent = 0) {
    const exam = await this.getExamById(examId, userId, sessionId);
    
    if (!exam) {
      throw new NotFoundError('Exam');
    }

    if (!this._checkAccess(exam, userId, sessionId)) {
      throw new ForbiddenError('Unauthorized to access this exam');
    }

    if (exam.status !== 'in_progress' && exam.status !== 'active') {
      throw new ExamNotStartedError();
    }

    if (exam.isTimeExpired()) {
      throw new ExamTimeExpiredError();
    }

    const result = await examRepository.submitAnswer(examId, questionId, answer, timeSpent);
    
    // Invalidate cache
    cache.del(cacheKeys.exam(examId));

    logger.debug('Answer submitted', { examId, questionId, isCorrect: result.isCorrect });

    return result;
  }

  /**
   * Complete an exam
   * @param {string} examId - Exam UUID
   * @param {number|null} userId - User ID
   * @param {string|null} sessionId - Session ID
   * @returns {Promise<Exam>} Completed exam with results
   */
  async completeExam(examId, userId = null, sessionId = null) {
    const exam = await this.getExamById(examId, userId, sessionId);
    
    if (!exam) {
      throw new NotFoundError('Exam');
    }

    if (!this._checkAccess(exam, userId, sessionId)) {
      throw new ForbiddenError('Unauthorized to access this exam');
    }

    if (exam.status === 'completed') {
      throw new ExamAlreadyCompletedError();
    }

    if (exam.status !== 'in_progress' && exam.status !== 'active') {
      throw new ExamNotStartedError();
    }

    const completedExam = await examRepository.complete(examId);
    
    // Invalidate cache
    cache.del(cacheKeys.exam(examId));

    // Update user stats if authenticated
    if (userId) {
      try {
        await this._updateUserStats(userId, completedExam);
      } catch (error) {
        logger.error('Failed to update user stats', { error: error.message, userId });
      }
    }

    // Update question statistics
    try {
      await this._updateQuestionStats(completedExam);
    } catch (error) {
      logger.error('Failed to update question stats', { error: error.message });
    }

    logger.info('Exam completed', { 
      examId, 
      score: completedExam.score, 
      passed: completedExam.passed 
    });

    return this._toExamModel(completedExam);
  }

  /**
   * Pause an exam
   * @param {string} examId - Exam UUID
   * @param {number|null} userId - User ID
   * @param {string|null} sessionId - Session ID
   * @returns {Promise<Exam>} Paused exam
   */
  async pauseExam(examId, userId = null, sessionId = null) {
    const exam = await this.getExamById(examId, userId, sessionId);
    
    if (!exam) {
      throw new NotFoundError('Exam');
    }

    if (!this._checkAccess(exam, userId, sessionId)) {
      throw new ForbiddenError('Unauthorized to access this exam');
    }

    if (exam.status !== 'in_progress' && exam.status !== 'active') {
      throw new BusinessError('Only active exams can be paused');
    }

    const pausedExam = await examRepository.pause(examId);
    cache.del(cacheKeys.exam(examId));

    logger.info('Exam paused', { examId });

    return this._toExamModel(pausedExam);
  }

  /**
   * Resume a paused exam
   * @param {string} examId - Exam UUID
   * @param {number|null} userId - User ID
   * @param {string|null} sessionId - Session ID
   * @returns {Promise<Exam>} Resumed exam
   */
  async resumeExam(examId, userId = null, sessionId = null) {
    const exam = await this.getExamById(examId, userId, sessionId);
    
    if (!exam) {
      throw new NotFoundError('Exam');
    }

    if (!this._checkAccess(exam, userId, sessionId)) {
      throw new ForbiddenError('Unauthorized to access this exam');
    }

    if (exam.status !== 'paused') {
      throw new BusinessError('Only paused exams can be resumed');
    }

    if (exam.isTimeExpired()) {
      throw new ExamTimeExpiredError();
    }

    const resumedExam = await examRepository.resume(examId);
    cache.del(cacheKeys.exam(examId));

    logger.info('Exam resumed', { examId });

    return this._toExamModel(resumedExam);
  }

  /**
   * Toggle question flag
   * @param {string} examId - Exam UUID
   * @param {string} questionId - Question UUID
   * @param {number|null} userId - User ID
   * @param {string|null} sessionId - Session ID
   * @returns {Promise<Object>} Flag status
   */
  async toggleFlag(examId, questionId, userId = null, sessionId = null) {
    const exam = await this.getExamById(examId, userId, sessionId);
    
    if (!exam) {
      throw new NotFoundError('Exam');
    }

    if (!this._checkAccess(exam, userId, sessionId)) {
      throw new ForbiddenError('Unauthorized to access this exam');
    }

    const result = await examRepository.toggleFlag(examId, questionId);
    cache.del(cacheKeys.exam(examId));

    return result;
  }

  /**
   * Get exam progress
   * @param {string} examId - Exam UUID
   * @param {number|null} userId - User ID
   * @param {string|null} sessionId - Session ID
   * @returns {Promise<Object>} Progress information
   */
  async getExamProgress(examId, userId = null, sessionId = null) {
    const exam = await this.getExamById(examId, userId, sessionId);
    
    if (!exam) {
      throw new NotFoundError('Exam');
    }

    if (!this._checkAccess(exam, userId, sessionId)) {
      throw new ForbiddenError('Unauthorized to access this exam');
    }

    return examRepository.getProgress(examId);
  }

  /**
   * Get user's exam history
   * @param {number} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Paginated exam history
   */
  async getUserExams(userId, options = {}) {
    return examRepository.findByUser(userId, options);
  }

  /**
   * Delete an exam
   * @param {string} examId - Exam UUID
   * @param {number|null} userId - User ID
   * @param {string|null} sessionId - Session ID
   */
  async deleteExam(examId, userId = null, sessionId = null) {
    const exam = await this.getExamById(examId, userId, sessionId);
    
    if (!exam) {
      throw new NotFoundError('Exam');
    }

    if (!this._checkAccess(exam, userId, sessionId)) {
      throw new ForbiddenError('Unauthorized to access this exam');
    }

    await examRepository.delete(examId);
    cache.del(cacheKeys.exam(examId));

    logger.info('Exam deleted', { examId });
  }

  /**
   * Get exam results
   * @param {string} examId - Exam UUID
   * @param {number|null} userId - User ID
   * @param {string|null} sessionId - Session ID
   * @returns {Promise<Object>} Exam results
   */
  async getExamResults(examId, userId = null, sessionId = null) {
    const exam = await this.getExamById(examId, userId, sessionId);
    
    if (!exam) {
      throw new NotFoundError('Exam');
    }

    if (!this._checkAccess(exam, userId, sessionId)) {
      throw new ForbiddenError('Unauthorized to access this exam');
    }

    if (exam.status !== 'completed') {
      throw new BusinessError('Exam not completed yet');
    }

    return exam.getResults();
  }

  // Private helper methods

  async _getOrCreateTempUser(sessionId) {
    const tempUsername = `temp_${sessionId}`;
    const tempEmail = `${tempUsername}@temp.local`;

    let user = await userRepository.findByUsername(tempUsername);
    
    if (!user) {
      user = await userRepository.create({
        username: tempUsername,
        email: tempEmail,
        password: 'temp_password_not_used',
        firstName: 'Temp',
        lastName: 'User',
        role: 'student',
      });
      logger.debug('Created temporary user', { userId: user.id, sessionId });
    }

    return user.id;
  }

  async _getCertification(providerId, certificationId) {
    const prisma = require('../lib/prisma');
    
    const certification = await prisma.certification.findFirst({
      where: {
        id: certificationId,
        providerId: providerId,
        isActive: true,
      },
      include: {
        provider: true,
      },
    });

    if (!certification) {
      throw new NotFoundError('Certification');
    }

    return certification;
  }

  _checkAccess(exam, userId, sessionId) {
    if (!exam) return false;
    
    // Admin can access any exam
    // For now, check ownership
    return exam.belongsTo(userId, sessionId);
  }

  _getModeLabel(mode) {
    const labels = {
      practice: 'Práctica',
      timed: 'Cronometrado',
      simulation: 'Simulación',
      failed_questions: 'Preguntas Fallidas',
    };
    return labels[mode] || 'Examen';
  }

  _toExamModel(examData, questions = null) {
    if (!examData) return null;

    const examQuestions = questions || examData.answers?.map(a => ({
      id: a.question?.id || a.questionId,
      text: a.question?.questionText,
      options: a.question?.options?.map(o => ({
        label: o.optionLabel,
        text: o.optionText,
      })) || [],
      userAnswer: a.userAnswer,
      isAnswered: a.userAnswer !== null,
      isCorrect: a.isCorrect,
      isFlagged: a.flagged,
      timeSpent: a.timeSpent,
    })) || [];

    return new Exam({
      id: examData.id,
      userId: examData.userId,
      sessionId: examData.sessionId,
      title: examData.title || 'Exam',
      provider: examData.certification?.provider?.name,
      certification: examData.certification?.code || examData.certificationId,
      mode: examData.mode,
      status: this._mapStatus(examData.status),
      totalQuestions: examData.questionCount,
      timeLimit: examData.timeLimit,
      passingScore: Number(examData.passingScore),
      score: examData.score,
      passed: examData.passed,
      startedAt: examData.startedAt,
      completedAt: examData.completedAt,
      currentQuestionIndex: examData.currentIndex || 0,
      questions: examQuestions,
      settings: examData.settings,
    });
  }

  _mapStatus(status) {
    const map = {
      pending: 'not_started',
      active: 'in_progress',
      paused: 'paused',
      completed: 'completed',
      abandoned: 'cancelled',
    };
    return map[status] || status;
  }

  async _updateUserStats(userId, exam) {
    // Implementation would update user statistics
    // This would be better in a separate stats service
    logger.debug('Updating user stats', { userId, examId: exam.id });
  }

  async _updateQuestionStats(exam) {
    // Update statistics for each answered question
    for (const answer of exam.answers || []) {
      if (answer.userAnswer !== null) {
        await questionRepository.updateStatistics(
          answer.questionId,
          answer.isCorrect,
          answer.timeSpent || 0
        );
      }
    }
  }
}

// Export singleton instance
module.exports = new ExamServicePrisma();
