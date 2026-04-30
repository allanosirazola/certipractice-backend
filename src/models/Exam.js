/**
 * @fileoverview Exam Model with validation and business logic
 */

const config = require('../config/config');

/**
 * Exam status enum
 */
const ExamStatus = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

/**
 * Exam mode enum
 */
const ExamMode = {
  PRACTICE: 'practice',
  EXAM: 'exam',
  FAILED_QUESTIONS: 'failed_questions',
};

/**
 * Map database status to client format
 */
const DB_TO_CLIENT_STATUS = {
  pending: ExamStatus.NOT_STARTED,
  active: ExamStatus.IN_PROGRESS,
  paused: ExamStatus.PAUSED,
  completed: ExamStatus.COMPLETED,
  cancelled: ExamStatus.CANCELLED,
};

/**
 * Map client status to database format
 */
const CLIENT_TO_DB_STATUS = {
  [ExamStatus.NOT_STARTED]: 'pending',
  [ExamStatus.IN_PROGRESS]: 'active',
  [ExamStatus.PAUSED]: 'paused',
  [ExamStatus.COMPLETED]: 'completed',
  [ExamStatus.CANCELLED]: 'cancelled',
};

class Exam {
  constructor(data = {}) {
    // Core identifiers
    this.id = data.id || null;
    this.userId = data.userId || data.user_id || null;
    this.sessionId = data.sessionId || data.session_id || null;

    // Exam info
    this.title = data.title || '';
    this.description = data.description || '';
    this.provider = data.provider || '';
    this.certification = data.certification || '';
    this.certificationId = data.certificationId || data.certification_id || null;
    this.mode = data.mode || data.exam_mode || ExamMode.PRACTICE;

    // Questions and answers
    this.questions = data.questions || [];
    this.answers = data.answers || {};

    // Time settings
    this.timeLimit = data.timeLimit || data.time_limit_minutes || config.exam.defaultTimeLimit;
    this.timeSpent = data.timeSpent || data.time_spent_minutes || 0;

    // Status
    this.status = this._normalizeStatus(data.status);

    // Scoring
    this.score = data.score || data.percentage_score || 0;
    this.passed = data.passed || data.passing_status === 'passed' || false;
    this.passingScore = data.passingScore || data.passing_score || config.exam.defaultPassingScore;

    // Statistics
    this.totalQuestions = data.totalQuestions || data.total_questions || this.questions.length;
    this.correctAnswers = data.correctAnswers || data.correct_answers || 0;
    this.incorrectAnswers = data.incorrectAnswers || data.incorrect_answers || 0;

    // Timestamps
    this.startedAt = data.startedAt || data.started_at || null;
    this.completedAt = data.completedAt || data.completed_at || null;
    this.createdAt = data.createdAt || data.created_at || new Date().toISOString();
    this.updatedAt = data.updatedAt || data.updated_at || new Date().toISOString();

    // Settings
    this.settings = {
      showExplanations: data.settings?.showExplanations ?? this.mode === ExamMode.PRACTICE,
      randomizeQuestions: data.settings?.randomizeQuestions ?? true,
      randomizeAnswers: data.settings?.randomizeAnswers ?? false,
      allowPause: data.settings?.allowPause ?? this.mode === ExamMode.PRACTICE,
      allowReview: data.settings?.allowReview ?? this.mode === ExamMode.PRACTICE,
      ...data.settings,
    };
  }

  /**
   * Normalize status from database or client format
   * @private
   */
  _normalizeStatus(status) {
    if (!status) return ExamStatus.NOT_STARTED;
    return DB_TO_CLIENT_STATUS[status] || status;
  }

  /**
   * Validate exam creation data
   * @param {Object} data - Exam data to validate
   * @returns {string[]} Array of validation errors
   */
  static validate(data) {
    const errors = [];

    // Required fields
    if (!data.provider && typeof data.provider !== 'number') {
      errors.push('Provider is required');
    }

    if (!data.certification && typeof data.certification !== 'number') {
      errors.push('Certification is required');
    }

    // Mode validation
    if (data.mode && !Object.values(ExamMode).includes(data.mode)) {
      errors.push(`Mode must be one of: ${Object.values(ExamMode).join(', ')}`);
    }

    // Question count validation
    if (data.questionCount !== undefined) {
      const count = parseInt(data.questionCount, 10);
      if (isNaN(count) || count < config.exam.minQuestions) {
        errors.push(`Question count must be at least ${config.exam.minQuestions}`);
      }
      if (count > config.exam.maxQuestions) {
        errors.push(`Question count cannot exceed ${config.exam.maxQuestions}`);
      }
    }

    // Time limit validation
    if (data.timeLimit !== undefined) {
      const time = parseInt(data.timeLimit, 10);
      if (isNaN(time) || time < 1) {
        errors.push('Time limit must be at least 1 minute');
      }
      if (time > config.exam.maxTimeLimit) {
        errors.push(`Time limit cannot exceed ${config.exam.maxTimeLimit} minutes`);
      }
    }

    // Passing score validation
    if (data.passingScore !== undefined) {
      const score = parseFloat(data.passingScore);
      if (isNaN(score) || score < 0 || score > 100) {
        errors.push('Passing score must be between 0 and 100');
      }
    }

    // Difficulty validation
    if (data.difficulty) {
      const validDifficulties = ['easy', 'medium', 'hard', 'expert'];
      if (!validDifficulties.includes(data.difficulty.toLowerCase())) {
        errors.push(`Difficulty must be one of: ${validDifficulties.join(', ')}`);
      }
    }

    return errors;
  }

  /**
   * Check if exam belongs to user or session
   * @param {number|null} userId
   * @param {string|null} sessionId
   * @returns {boolean}
   */
  belongsTo(userId, sessionId) {
    if (userId && this.userId === userId) {
      return true;
    }
    if (sessionId && this.sessionId === sessionId) {
      return true;
    }
    return false;
  }

  /**
   * Calculate score based on answers
   * @returns {number} Score percentage
   */
  calculateScore() {
    if (this.questions.length === 0) return 0;

    let correctCount = 0;
    let totalPoints = 0;
    let earnedPoints = 0;

    this.questions.forEach((question) => {
      const points = question.points || 1;
      totalPoints += points;

      const userAnswer = this.answers[question.id];
      if (userAnswer !== undefined && this.isAnswerCorrect(question, userAnswer)) {
        correctCount++;
        earnedPoints += points;
      }
    });

    this.correctAnswers = correctCount;
    this.incorrectAnswers = this.questions.length - correctCount;
    this.score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    this.passed = this.score >= this.passingScore;

    return this.score;
  }

  /**
   * Check if user answer is correct
   * @param {Object} question
   * @param {number|number[]} userAnswer
   * @returns {boolean}
   */
  isAnswerCorrect(question, userAnswer) {
    if (!question.correctAnswers || question.correctAnswers.length === 0) {
      return false;
    }

    const isMultiple = question.isMultipleChoice || question.questionType === 'multiple_answer';

    if (isMultiple) {
      if (!Array.isArray(userAnswer)) {
        return false;
      }

      if (userAnswer.length !== question.correctAnswers.length) {
        return false;
      }

      const sortedUser = [...userAnswer].map(Number).sort((a, b) => a - b);
      const sortedCorrect = [...question.correctAnswers].map(Number).sort((a, b) => a - b);

      return JSON.stringify(sortedUser) === JSON.stringify(sortedCorrect);
    } else {
      const answer = Array.isArray(userAnswer) ? userAnswer[0] : userAnswer;
      return question.correctAnswers.map(Number).includes(Number(answer));
    }
  }

  /**
   * Validate an answer before saving
   * @param {number} questionId
   * @param {number|number[]} answer
   * @returns {number|number[]} Validated and cleaned answer
   * @throws {Error} If validation fails
   */
  validateAnswer(questionId, answer) {
    const question = this.questions.find((q) => q.id === questionId);

    if (!question) {
      throw new Error('Question not found in exam');
    }

    const isMultiple = question.isMultipleChoice || question.questionType === 'multiple_answer';
    const maxIndex = question.options.length - 1;

    if (isMultiple) {
      if (!Array.isArray(answer)) {
        throw new Error('Multiple choice questions require array answers');
      }

      if (answer.length === 0) {
        throw new Error('At least one answer must be selected');
      }

      if (question.expectedAnswers && answer.length > question.expectedAnswers) {
        throw new Error(`Too many answers. Expected maximum: ${question.expectedAnswers}`);
      }

      // Validate indices and remove duplicates
      const validatedAnswers = [...new Set(answer)].map((idx) => {
        const num = Number(idx);
        if (!Number.isInteger(num) || num < 0 || num > maxIndex) {
          throw new Error(`Invalid answer index: ${idx}`);
        }
        return num;
      });

      return validatedAnswers;
    } else {
      const singleAnswer = Array.isArray(answer) ? answer[0] : answer;
      const num = Number(singleAnswer);

      if (!Number.isInteger(num) || num < 0 || num > maxIndex) {
        throw new Error(`Invalid answer index: ${singleAnswer}`);
      }

      return num;
    }
  }

  /**
   * Get time remaining in seconds
   * @returns {number}
   */
  getTimeRemaining() {
    if (this.status !== ExamStatus.IN_PROGRESS || !this.startedAt) {
      return 0;
    }

    const startTime = new Date(this.startedAt);
    const elapsedMs = Date.now() - startTime.getTime();
    const elapsedMinutes = elapsedMs / 1000 / 60;
    const remainingMinutes = Math.max(0, this.timeLimit - elapsedMinutes);

    return Math.floor(remainingMinutes * 60);
  }

  /**
   * Check if exam time has expired
   * @returns {boolean}
   */
  isTimeExpired() {
    return this.getTimeRemaining() <= 0 && this.status === ExamStatus.IN_PROGRESS;
  }

  /**
   * Get exam progress
   * @returns {Object}
   */
  getProgress() {
    const answeredQuestions = Object.keys(this.answers).length;
    const totalQuestions = this.questions.length;

    // Count correct/incorrect among answered
    let correctAnswers = 0;
    let incorrectAnswers = 0;

    this.questions.forEach((question) => {
      const userAnswer = this.answers[question.id];
      if (userAnswer !== undefined) {
        if (this.isAnswerCorrect(question, userAnswer)) {
          correctAnswers++;
        } else {
          incorrectAnswers++;
        }
      }
    });

    // Stats by question type
    const multipleChoiceQuestions = this.questions.filter(
      (q) => q.isMultipleChoice || q.questionType === 'multiple_answer'
    );
    const singleChoiceQuestions = this.questions.filter(
      (q) => !q.isMultipleChoice && q.questionType !== 'multiple_answer'
    );

    return {
      totalQuestions,
      answeredQuestions,
      remainingQuestions: totalQuestions - answeredQuestions,
      progressPercentage: totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0,
      correctAnswers,
      incorrectAnswers,
      accuracyPercentage: answeredQuestions > 0 ? Math.round((correctAnswers / answeredQuestions) * 100) : 0,
      multipleChoiceProgress: {
        total: multipleChoiceQuestions.length,
        answered: multipleChoiceQuestions.filter((q) => this.answers[q.id] !== undefined).length,
      },
      singleChoiceProgress: {
        total: singleChoiceQuestions.length,
        answered: singleChoiceQuestions.filter((q) => this.answers[q.id] !== undefined).length,
      },
    };
  }

  /**
   * Get detailed exam results
   * @returns {Object}
   */
  getResults() {
    const results = {
      examId: this.id,
      score: this.score,
      passed: this.passed,
      passingScore: this.passingScore,
      totalQuestions: this.questions.length,
      correctAnswers: 0,
      incorrectAnswers: 0,
      unansweredQuestions: 0,
      timeSpent: this.timeSpent,
      timeLimit: this.timeLimit,
      efficiency: 0,
      questionResults: [],
      difficultyStats: {
        easy: { total: 0, correct: 0, percentage: 0 },
        medium: { total: 0, correct: 0, percentage: 0 },
        hard: { total: 0, correct: 0, percentage: 0 },
        expert: { total: 0, correct: 0, percentage: 0 },
      },
      categoryStats: {},
    };

    this.questions.forEach((question) => {
      const userAnswer = this.answers[question.id];
      const isAnswered = userAnswer !== undefined;
      const isCorrect = isAnswered ? this.isAnswerCorrect(question, userAnswer) : false;

      // Update counters
      if (isCorrect) {
        results.correctAnswers++;
      } else if (isAnswered) {
        results.incorrectAnswers++;
      } else {
        results.unansweredQuestions++;
      }

      // Difficulty stats
      const difficulty = question.difficulty || 'medium';
      if (results.difficultyStats[difficulty]) {
        results.difficultyStats[difficulty].total++;
        if (isCorrect) {
          results.difficultyStats[difficulty].correct++;
        }
      }

      // Category stats
      const category = question.category || 'General';
      if (!results.categoryStats[category]) {
        results.categoryStats[category] = { total: 0, correct: 0, percentage: 0 };
      }
      results.categoryStats[category].total++;
      if (isCorrect) {
        results.categoryStats[category].correct++;
      }

      results.questionResults.push({
        questionId: question.id,
        questionText: question.text,
        difficulty,
        category,
        userAnswer,
        correctAnswers: question.correctAnswers,
        isAnswered,
        isCorrect,
        explanation: question.explanation,
      });
    });

    // Calculate percentages
    Object.values(results.difficultyStats).forEach((stat) => {
      stat.percentage = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
    });

    Object.values(results.categoryStats).forEach((stat) => {
      stat.percentage = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
    });

    // Calculate efficiency
    if (this.timeSpent > 0) {
      results.efficiency = Math.round((results.correctAnswers / this.timeSpent) * 100) / 100;
    }

    return results;
  }

  /**
   * Get exam summary
   * @returns {Object}
   */
  getSummary() {
    const progress = this.getProgress();

    return {
      id: this.id,
      title: this.title,
      provider: this.provider,
      certification: this.certification,
      mode: this.mode,
      status: this.status,
      progress: progress.progressPercentage,
      accuracy: progress.accuracyPercentage,
      score: this.score,
      passed: this.passed,
      passingScore: this.passingScore,
      timeLimit: this.timeLimit,
      timeSpent: this.timeSpent,
      timeRemaining: this.getTimeRemaining(),
      isTimeExpired: this.isTimeExpired(),
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      statistics: {
        totalQuestions: this.totalQuestions,
        answeredQuestions: progress.answeredQuestions,
        correctAnswers: progress.correctAnswers,
        incorrectAnswers: progress.incorrectAnswers,
      },
    };
  }

  /**
   * Convert to JSON for API response
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      sessionId: this.sessionId,
      title: this.title,
      description: this.description,
      provider: this.provider,
      certification: this.certification,
      mode: this.mode,
      questions: this.questions,
      answers: this.answers,
      timeLimit: this.timeLimit,
      timeSpent: this.timeSpent,
      status: this.status,
      score: this.score,
      passed: this.passed,
      passingScore: this.passingScore,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      settings: this.settings,
      summary: this.getSummary(),
    };
  }

  /**
   * Convert to format for exam review
   * @returns {Object}
   */
  toReviewFormat() {
    return {
      ...this.toJSON(),
      questions: this.questions.map((question) => ({
        ...question,
        correctAnswers: question.correctAnswers || [],
        explanation: question.explanation || 'No explanation available',
      })),
      results: this.getResults(),
    };
  }

  /**
   * Convert status to database format
   * @returns {string}
   */
  getDbStatus() {
    return CLIENT_TO_DB_STATUS[this.status] || this.status;
  }
}

// Export enums
Exam.Status = ExamStatus;
Exam.Mode = ExamMode;

module.exports = Exam;
