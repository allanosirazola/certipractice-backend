/**
 * @fileoverview Exam Repository
 * Handles all database operations for exams using Prisma
 */

const prisma = require('../lib/prisma');

class ExamRepository {
  /**
   * Find exam by ID with all relations
   * @param {string} id - Exam UUID
   * @param {boolean} includeAnswers - Include correct answers for questions
   * @returns {Promise<Object|null>}
   */
  async findById(id, includeAnswers = false) {
    const exam = await prisma.exam.findUnique({
      where: { id },
      include: {
        certification: {
          include: {
            provider: true,
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        answers: {
          include: {
            question: {
              include: {
                options: {
                  orderBy: { orderIndex: 'asc' },
                  select: {
                    optionLabel: true,
                    optionText: true,
                    isCorrect: includeAnswers,
                  },
                },
              },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    return exam ? this._formatExam(exam, includeAnswers) : null;
  }

  /**
   * Find exams by user ID with pagination
   * @param {number} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<{exams: Array, total: number}>}
   */
  async findByUser(userId, options = {}) {
    const {
      page = 1,
      limit = 10,
      status,
      certificationId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = options;

    const where = { userId };

    if (status) {
      where.status = status;
    }

    if (certificationId) {
      where.certificationId = certificationId;
    }

    const [exams, total] = await Promise.all([
      prisma.exam.findMany({
        where,
        include: {
          certification: {
            include: {
              provider: true,
            },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.exam.count({ where }),
    ]);

    return {
      exams: exams.map(e => this._formatExamSummary(e)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find exams by session ID (for anonymous users)
   * @param {string} sessionId - Session ID
   * @param {Object} options - Query options
   * @returns {Promise<{exams: Array, total: number}>}
   */
  async findBySession(sessionId, options = {}) {
    const { page = 1, limit = 10 } = options;

    const where = { sessionId };

    const [exams, total] = await Promise.all([
      prisma.exam.findMany({
        where,
        include: {
          certification: {
            include: {
              provider: true,
            },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.exam.count({ where }),
    ]);

    return {
      exams: exams.map(e => this._formatExamSummary(e)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Create a new exam
   * @param {Object} data - Exam data
   * @param {Array} questionIds - Array of question UUIDs
   * @returns {Promise<Object>}
   */
  async create(data, questionIds) {
    const exam = await prisma.exam.create({
      data: {
        userId: data.userId || null,
        sessionId: data.sessionId || null,
        certificationId: data.certificationId,
        title: data.title,
        description: data.description || null,
        mode: data.mode || 'practice',
        questionCount: questionIds.length,
        timeLimit: data.timeLimit,
        passingScore: data.passingScore || 70,
        settings: data.settings || {},
        answers: {
          create: questionIds.map((questionId, index) => ({
            questionId,
            orderIndex: index,
          })),
        },
      },
      include: {
        certification: {
          include: {
            provider: true,
          },
        },
        answers: {
          include: {
            question: {
              include: {
                options: {
                  orderBy: { orderIndex: 'asc' },
                },
              },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    return this._formatExam(exam, false);
  }

  /**
   * Start an exam
   * @param {string} id - Exam UUID
   * @returns {Promise<Object>}
   */
  async start(id) {
    const exam = await prisma.exam.update({
      where: { id },
      data: {
        status: 'active',
        startedAt: new Date(),
      },
      include: {
        certification: {
          include: {
            provider: true,
          },
        },
        answers: {
          include: {
            question: {
              include: {
                options: {
                  orderBy: { orderIndex: 'asc' },
                },
              },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    return this._formatExam(exam, false);
  }

  /**
   * Submit answer for a question
   * @param {string} examId - Exam UUID
   * @param {string} questionId - Question UUID
   * @param {Array} answer - User's answer (array of option indices)
   * @param {number} timeSpent - Time spent in seconds
   * @returns {Promise<Object>}
   */
  async submitAnswer(examId, questionId, answer, timeSpent = 0) {
    // Get the question to check if answer is correct
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        options: {
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    const correctIndices = question.options
      .map((opt, idx) => opt.isCorrect ? idx : -1)
      .filter(idx => idx !== -1);

    const sortedAnswer = [...answer].sort();
    const sortedCorrect = [...correctIndices].sort();
    const isCorrect = JSON.stringify(sortedAnswer) === JSON.stringify(sortedCorrect);

    const examAnswer = await prisma.examAnswer.update({
      where: {
        examId_questionId: {
          examId,
          questionId,
        },
      },
      data: {
        userAnswer: answer,
        isCorrect,
        timeSpent,
        answeredAt: new Date(),
      },
    });

    // Update current index
    await prisma.exam.update({
      where: { id: examId },
      data: {
        currentIndex: {
          increment: 1,
        },
      },
    });

    return {
      questionId,
      isCorrect,
      answeredAt: examAnswer.answeredAt,
    };
  }

  /**
   * Complete an exam and calculate results
   * @param {string} id - Exam UUID
   * @returns {Promise<Object>}
   */
  async complete(id) {
    // Get all answers
    const answers = await prisma.examAnswer.findMany({
      where: { examId: id },
    });

    const answeredCount = answers.filter(a => a.userAnswer !== null).length;
    const correctCount = answers.filter(a => a.isCorrect === true).length;
    const totalQuestions = answers.length;
    const score = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

    // Get exam to check passing score
    const examData = await prisma.exam.findUnique({
      where: { id },
      select: { passingScore: true },
    });

    const passed = score >= Number(examData.passingScore);

    const exam = await prisma.exam.update({
      where: { id },
      data: {
        status: 'completed',
        score,
        passed,
        completedAt: new Date(),
      },
      include: {
        certification: {
          include: {
            provider: true,
          },
        },
        answers: {
          include: {
            question: {
              include: {
                options: {
                  orderBy: { orderIndex: 'asc' },
                },
              },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    return {
      ...this._formatExam(exam, true),
      results: {
        totalQuestions,
        answeredCount,
        correctCount,
        incorrectCount: answeredCount - correctCount,
        skippedCount: totalQuestions - answeredCount,
        score: Number(score.toFixed(2)),
        passed,
        passingScore: Number(examData.passingScore),
      },
    };
  }

  /**
   * Pause an exam
   * @param {string} id - Exam UUID
   * @returns {Promise<Object>}
   */
  async pause(id) {
    const exam = await prisma.exam.update({
      where: { id },
      data: {
        status: 'paused',
        pausedAt: new Date(),
      },
    });

    return this._formatExamSummary(exam);
  }

  /**
   * Resume an exam
   * @param {string} id - Exam UUID
   * @returns {Promise<Object>}
   */
  async resume(id) {
    const exam = await prisma.exam.findUnique({
      where: { id },
    });

    const pausedDuration = exam.pausedAt 
      ? Math.floor((Date.now() - exam.pausedAt.getTime()) / 1000)
      : 0;

    const updated = await prisma.exam.update({
      where: { id },
      data: {
        status: 'active',
        pausedAt: null,
        totalPausedTime: {
          increment: pausedDuration,
        },
      },
      include: {
        certification: {
          include: {
            provider: true,
          },
        },
        answers: {
          include: {
            question: {
              include: {
                options: {
                  orderBy: { orderIndex: 'asc' },
                },
              },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    return this._formatExam(updated, false);
  }

  /**
   * Toggle question flag
   * @param {string} examId - Exam UUID
   * @param {string} questionId - Question UUID
   * @returns {Promise<Object>}
   */
  async toggleFlag(examId, questionId) {
    const answer = await prisma.examAnswer.findUnique({
      where: {
        examId_questionId: {
          examId,
          questionId,
        },
      },
    });

    const updated = await prisma.examAnswer.update({
      where: {
        examId_questionId: {
          examId,
          questionId,
        },
      },
      data: {
        flagged: !answer.flagged,
      },
    });

    return {
      questionId,
      flagged: updated.flagged,
    };
  }

  /**
   * Get exam progress
   * @param {string} id - Exam UUID
   * @returns {Promise<Object>}
   */
  async getProgress(id) {
    const exam = await prisma.exam.findUnique({
      where: { id },
      include: {
        answers: {
          select: {
            questionId: true,
            userAnswer: true,
            flagged: true,
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    if (!exam) return null;

    const answered = exam.answers.filter(a => a.userAnswer !== null).length;
    const flagged = exam.answers.filter(a => a.flagged).length;

    let remainingTime = null;
    if (exam.startedAt && exam.status === 'active') {
      const elapsed = Math.floor((Date.now() - exam.startedAt.getTime()) / 1000);
      const pausedTime = exam.totalPausedTime || 0;
      const effectiveElapsed = elapsed - pausedTime;
      remainingTime = Math.max(0, (exam.timeLimit * 60) - effectiveElapsed);
    }

    return {
      examId: exam.id,
      status: exam.status,
      currentIndex: exam.currentIndex,
      totalQuestions: exam.questionCount,
      answeredCount: answered,
      flaggedCount: flagged,
      remainingTime,
      questions: exam.answers.map(a => ({
        questionId: a.questionId,
        answered: a.userAnswer !== null,
        flagged: a.flagged,
      })),
    };
  }

  /**
   * Delete exam by ID
   * @param {string} id - Exam UUID
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    try {
      await prisma.exam.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      if (error.code === 'P2025') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Check if user owns exam
   * @param {string} examId - Exam UUID
   * @param {number} userId - User ID
   * @returns {Promise<boolean>}
   */
  async isOwner(examId, userId) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: { userId: true },
    });

    return exam?.userId === userId;
  }

  /**
   * Check if session owns exam
   * @param {string} examId - Exam UUID
   * @param {string} sessionId - Session ID
   * @returns {Promise<boolean>}
   */
  async isSessionOwner(examId, sessionId) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: { sessionId: true },
    });

    return exam?.sessionId === sessionId;
  }

  /**
   * Get user exam statistics
   * @param {number} userId - User ID
   * @returns {Promise<Object>}
   */
  async getUserStats(userId) {
    const stats = await prisma.exam.aggregate({
      where: {
        userId,
        status: 'completed',
      },
      _count: true,
      _avg: {
        score: true,
      },
    });

    const passed = await prisma.exam.count({
      where: {
        userId,
        status: 'completed',
        passed: true,
      },
    });

    const byCertification = await prisma.exam.groupBy({
      by: ['certificationId'],
      where: {
        userId,
        status: 'completed',
      },
      _count: true,
      _avg: {
        score: true,
      },
    });

    return {
      totalExams: stats._count,
      averageScore: stats._avg.score ? Number(stats._avg.score.toFixed(2)) : 0,
      passedExams: passed,
      passRate: stats._count > 0 
        ? Number(((passed / stats._count) * 100).toFixed(2)) 
        : 0,
      byCertification,
    };
  }

  // ==================== Private Methods ====================

  /**
   * Format exam for full response
   */
  _formatExam(exam, includeCorrectAnswers) {
    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      mode: exam.mode,
      status: exam.status,
      questionCount: exam.questionCount,
      timeLimit: exam.timeLimit,
      passingScore: Number(exam.passingScore),
      currentIndex: exam.currentIndex,
      score: exam.score ? Number(exam.score) : null,
      passed: exam.passed,
      startedAt: exam.startedAt,
      completedAt: exam.completedAt,
      createdAt: exam.createdAt,
      certification: exam.certification ? {
        id: exam.certification.id,
        name: exam.certification.name,
        code: exam.certification.code,
        provider: exam.certification.provider?.name,
      } : null,
      user: exam.user || null,
      questions: exam.answers?.map(answer => ({
        id: answer.question.id,
        orderIndex: answer.orderIndex,
        text: answer.question.questionText,
        options: answer.question.options.map(opt => ({
          label: opt.optionLabel,
          text: opt.optionText,
          ...(includeCorrectAnswers && { isCorrect: opt.isCorrect }),
        })),
        userAnswer: answer.userAnswer,
        isCorrect: answer.isCorrect,
        flagged: answer.flagged,
        timeSpent: answer.timeSpent,
      })) || [],
    };
  }

  /**
   * Format exam for summary/list response
   */
  _formatExamSummary(exam) {
    return {
      id: exam.id,
      title: exam.title,
      mode: exam.mode,
      status: exam.status,
      questionCount: exam.questionCount,
      timeLimit: exam.timeLimit,
      score: exam.score ? Number(exam.score) : null,
      passed: exam.passed,
      startedAt: exam.startedAt,
      completedAt: exam.completedAt,
      createdAt: exam.createdAt,
      certification: exam.certification ? {
        id: exam.certification.id,
        name: exam.certification.name,
        code: exam.certification.code,
        provider: exam.certification.provider?.name,
      } : null,
    };
  }
}

module.exports = new ExamRepository();
