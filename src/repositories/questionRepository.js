/**
 * @fileoverview Question Repository
 * Handles all database operations for questions using Prisma
 */

const prisma = require('../lib/prisma');
const crypto = require('crypto');

class QuestionRepository {
  /**
   * Find question by ID with all relations
   * @param {string} id - Question UUID
   * @param {boolean} includeAnswers - Include correct answers
   * @returns {Promise<Object|null>}
   */
  async findById(id, includeAnswers = false) {
    const question = await prisma.question.findUnique({
      where: { id },
      include: {
        options: {
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            optionLabel: true,
            optionText: true,
            isCorrect: includeAnswers,
            orderIndex: true,
          },
        },
        topic: {
          include: {
            certification: {
              include: {
                provider: true,
              },
            },
          },
        },
        questionType: true,
        statistics: true,
      },
    });

    return question ? this._formatQuestion(question, includeAnswers) : null;
  }

  /**
   * Find questions with pagination and filters
   * @param {Object} options - Query options
   * @returns {Promise<{questions: Array, total: number}>}
   */
  async findAll(options = {}) {
    const {
      page = 1,
      limit = 20,
      providerId,
      certificationId,
      topicId,
      difficulty,
      reviewStatus,
      search,
      tags,
      isActive = true,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      includeAnswers = false,
    } = options;

    const where = this._buildWhereClause({
      providerId,
      certificationId,
      topicId,
      difficulty,
      reviewStatus,
      search,
      tags,
      isActive,
    });

    const [questions, total] = await Promise.all([
      prisma.question.findMany({
        where,
        include: this._getQuestionInclude(includeAnswers),
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.question.count({ where }),
    ]);

    return {
      questions: questions.map(q => this._formatQuestion(q, includeAnswers)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get random questions for exam
   * @param {Object} options - Selection options
   * @returns {Promise<Array>}
   */
  async findRandom(options = {}) {
    const {
      count = 10,
      certificationId,
      topicIds,
      difficulty,
      excludeIds = [],
    } = options;

    const where = {
      isActive: true,
      reviewStatus: 'approved',
    };

    if (certificationId) {
      where.topic = {
        certificationId,
      };
    }

    if (topicIds && topicIds.length > 0) {
      where.topicId = { in: topicIds };
    }

    if (difficulty) {
      where.difficulty = difficulty;
    }

    if (excludeIds.length > 0) {
      where.id = { notIn: excludeIds };
    }

    // PostgreSQL-specific random ordering
    const questions = await prisma.$queryRaw`
      SELECT q.id
      FROM questions q
      JOIN topics t ON q.topic_id = t.id
      WHERE q.is_active = true
        AND q.review_status = 'approved'
        ${certificationId ? prisma.$queryRaw`AND t.certification_id = ${certificationId}` : prisma.$queryRaw``}
        ${excludeIds.length > 0 ? prisma.$queryRaw`AND q.id NOT IN (${prisma.Prisma.join(excludeIds)})` : prisma.$queryRaw``}
      ORDER BY RANDOM()
      LIMIT ${count}
    `;

    if (questions.length === 0) {
      return [];
    }

    // Get full question data
    const fullQuestions = await prisma.question.findMany({
      where: {
        id: { in: questions.map(q => q.id) },
      },
      include: this._getQuestionInclude(false),
    });

    return fullQuestions.map(q => this._formatQuestion(q, false));
  }

  /**
   * Search questions by text
   * @param {string} searchTerm - Search term
   * @param {number} limit - Max results
   * @returns {Promise<Array>}
   */
  async search(searchTerm, limit = 20) {
    const questions = await prisma.question.findMany({
      where: {
        isActive: true,
        OR: [
          { questionText: { contains: searchTerm, mode: 'insensitive' } },
          { explanation: { contains: searchTerm, mode: 'insensitive' } },
          { tags: { has: searchTerm.toLowerCase() } },
        ],
      },
      include: this._getQuestionInclude(false),
      take: limit,
    });

    return questions.map(q => this._formatQuestion(q, false));
  }

  /**
   * Create a new question
   * @param {Object} data - Question data
   * @returns {Promise<Object>}
   */
  async create(data) {
    const contentHash = this._generateContentHash(data.questionText, data.options);

    const question = await prisma.question.create({
      data: {
        topicId: data.topicId,
        questionTypeId: data.questionTypeId,
        questionText: data.questionText,
        explanation: data.explanation || null,
        difficulty: data.difficulty || 'medium',
        points: data.points || 1,
        timeEstimate: data.timeEstimate || null,
        tags: data.tags || [],
        contentHash,
        metadata: data.metadata || {},
        reviewStatus: 'pending',
        createdById: data.createdById || null,
        options: {
          create: data.options.map((opt, index) => ({
            optionLabel: opt.label,
            optionText: opt.text,
            isCorrect: opt.isCorrect || false,
            orderIndex: index,
          })),
        },
        statistics: {
          create: {},
        },
      },
      include: this._getQuestionInclude(true),
    });

    return this._formatQuestion(question, true);
  }

  /**
   * Update question by ID
   * @param {string} id - Question UUID
   * @param {Object} data - Fields to update
   * @returns {Promise<Object|null>}
   */
  async update(id, data) {
    const updateData = {};

    // Map allowed fields
    const allowedFields = [
      'questionText', 'explanation', 'difficulty', 'points',
      'timeEstimate', 'tags', 'reviewStatus', 'reviewedById',
      'reviewNotes', 'isActive', 'topicId',
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    // Update content hash if text or options changed
    if (data.questionText || data.options) {
      const currentQuestion = await prisma.question.findUnique({
        where: { id },
        include: { options: true },
      });

      const newText = data.questionText || currentQuestion.questionText;
      const newOptions = data.options || currentQuestion.options.map(o => ({
        label: o.optionLabel,
        text: o.optionText,
      }));

      updateData.contentHash = this._generateContentHash(newText, newOptions);
    }

    if (data.reviewStatus && data.reviewedById) {
      updateData.reviewedAt = new Date();
    }

    const question = await prisma.question.update({
      where: { id },
      data: updateData,
      include: this._getQuestionInclude(true),
    });

    // Update options if provided
    if (data.options) {
      await prisma.questionOption.deleteMany({
        where: { questionId: id },
      });

      await prisma.questionOption.createMany({
        data: data.options.map((opt, index) => ({
          questionId: id,
          optionLabel: opt.label,
          optionText: opt.text,
          isCorrect: opt.isCorrect || false,
          orderIndex: index,
        })),
      });
    }

    return this._formatQuestion(question, true);
  }

  /**
   * Delete question by ID
   * @param {string} id - Question UUID
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    try {
      await prisma.question.delete({
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
   * Get questions pending review
   * @param {number} limit - Max results
   * @returns {Promise<Array>}
   */
  async findPendingReview(limit = 50) {
    const questions = await prisma.question.findMany({
      where: {
        reviewStatus: 'pending',
        isActive: true,
      },
      include: this._getQuestionInclude(true),
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return questions.map(q => this._formatQuestion(q, true));
  }

  /**
   * Review a question (approve/reject)
   * @param {string} id - Question UUID
   * @param {string} status - New status
   * @param {number} reviewerId - Reviewer user ID
   * @param {string} notes - Review notes
   * @returns {Promise<Object>}
   */
  async review(id, status, reviewerId, notes = null) {
    const question = await prisma.question.update({
      where: { id },
      data: {
        reviewStatus: status,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNotes: notes,
      },
      include: this._getQuestionInclude(true),
    });

    return this._formatQuestion(question, true);
  }

  /**
   * Bulk create questions (transactional)
   * @param {Array} questions - Array of question data
   * @returns {Promise<Array>}
   */
  async bulkCreate(questions) {
    return prisma.$transaction(async (tx) => {
      const created = [];

      for (const questionData of questions) {
        const contentHash = this._generateContentHash(
          questionData.questionText,
          questionData.options
        );

        const question = await tx.question.create({
          data: {
            topicId: questionData.topicId,
            questionTypeId: questionData.questionTypeId,
            questionText: questionData.questionText,
            explanation: questionData.explanation || null,
            difficulty: questionData.difficulty || 'medium',
            points: questionData.points || 1,
            tags: questionData.tags || [],
            contentHash,
            reviewStatus: 'pending',
            createdById: questionData.createdById || null,
            options: {
              create: questionData.options.map((opt, index) => ({
                optionLabel: opt.label,
                optionText: opt.text,
                isCorrect: opt.isCorrect || false,
                orderIndex: index,
              })),
            },
            statistics: {
              create: {},
            },
          },
        });

        created.push(question);
      }

      return created;
    });
  }

  /**
   * Update question statistics
   * @param {string} id - Question UUID
   * @param {boolean} isCorrect - Whether answer was correct
   * @param {number} timeSpent - Time spent in seconds
   * @returns {Promise<void>}
   */
  async updateStatistics(id, isCorrect, timeSpent) {
    await prisma.questionStatistics.upsert({
      where: { questionId: id },
      update: {
        totalAttempts: { increment: 1 },
        correctAttempts: isCorrect ? { increment: 1 } : undefined,
        averageTimeSeconds: timeSpent, // Simplified - would need running average
        lastAttemptedAt: new Date(),
      },
      create: {
        questionId: id,
        totalAttempts: 1,
        correctAttempts: isCorrect ? 1 : 0,
        averageTimeSeconds: timeSpent,
        lastAttemptedAt: new Date(),
      },
    });
  }

  /**
   * Get question count by certification
   * @param {number} certificationId - Certification ID
   * @returns {Promise<number>}
   */
  async countByCertification(certificationId) {
    return prisma.question.count({
      where: {
        isActive: true,
        reviewStatus: 'approved',
        topic: {
          certificationId,
        },
      },
    });
  }

  /**
   * Get all topics with question counts
   * @returns {Promise<Array>}
   */
  async getCategories() {
    const topics = await prisma.topic.findMany({
      where: { isActive: true },
      include: {
        certification: {
          include: {
            provider: true,
          },
        },
        _count: {
          select: {
            questions: {
              where: { isActive: true, reviewStatus: 'approved' },
            },
          },
        },
      },
      orderBy: [
        { certification: { provider: { name: 'asc' } } },
        { certification: { name: 'asc' } },
        { name: 'asc' },
      ],
    });

    return topics.map(topic => ({
      id: topic.id,
      name: topic.name,
      certification: topic.certification.name,
      certificationCode: topic.certification.code,
      provider: topic.certification.provider.name,
      questionCount: topic._count.questions,
    }));
  }

  /**
   * Get all providers with certification counts
   * @returns {Promise<Array>}
   */
  async getProviders() {
    const providers = await prisma.provider.findMany({
      where: { isActive: true },
      include: {
        certifications: {
          where: { isActive: true },
          include: {
            _count: {
              select: {
                topics: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      code: provider.code,
      certifications: provider.certifications.map(cert => ({
        id: cert.id,
        name: cert.name,
        code: cert.code,
        topicCount: cert._count.topics,
      })),
    }));
  }

  // ==================== Private Methods ====================

  /**
   * Build where clause from filters
   */
  _buildWhereClause(filters) {
    const where = {};

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.providerId) {
      where.topic = {
        certification: {
          providerId: filters.providerId,
        },
      };
    }

    if (filters.certificationId) {
      where.topic = {
        ...where.topic,
        certificationId: filters.certificationId,
      };
    }

    if (filters.topicId) {
      where.topicId = filters.topicId;
    }

    if (filters.difficulty) {
      where.difficulty = filters.difficulty;
    }

    if (filters.reviewStatus) {
      where.reviewStatus = filters.reviewStatus;
    }

    if (filters.tags && filters.tags.length > 0) {
      where.tags = { hasEvery: filters.tags };
    }

    if (filters.search) {
      where.OR = [
        { questionText: { contains: filters.search, mode: 'insensitive' } },
        { explanation: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  /**
   * Get include object for question queries
   */
  _getQuestionInclude(includeAnswers) {
    return {
      options: {
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          optionLabel: true,
          optionText: true,
          isCorrect: includeAnswers,
          orderIndex: true,
        },
      },
      topic: {
        include: {
          certification: {
            include: {
              provider: true,
            },
          },
        },
      },
      questionType: true,
      statistics: true,
    };
  }

  /**
   * Format question for response
   */
  _formatQuestion(question, includeAnswers) {
    const formatted = {
      id: question.id,
      text: question.questionText,
      explanation: question.explanation,
      difficulty: question.difficulty,
      points: question.points,
      timeEstimate: question.timeEstimate,
      tags: question.tags,
      reviewStatus: question.reviewStatus,
      isActive: question.isActive,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
      options: question.options.map(opt => ({
        label: opt.optionLabel,
        text: opt.optionText,
        ...(includeAnswers && { isCorrect: opt.isCorrect }),
      })),
      topic: question.topic ? {
        id: question.topic.id,
        name: question.topic.name,
      } : null,
      certification: question.topic?.certification ? {
        id: question.topic.certification.id,
        name: question.topic.certification.name,
        code: question.topic.certification.code,
      } : null,
      provider: question.topic?.certification?.provider ? {
        id: question.topic.certification.provider.id,
        name: question.topic.certification.provider.name,
      } : null,
      questionType: question.questionType ? {
        id: question.questionType.id,
        name: question.questionType.name,
      } : null,
      statistics: question.statistics ? {
        totalAttempts: question.statistics.totalAttempts,
        correctAttempts: question.statistics.correctAttempts,
        successRate: question.statistics.totalAttempts > 0
          ? (question.statistics.correctAttempts / question.statistics.totalAttempts * 100).toFixed(1)
          : 0,
        averageTime: question.statistics.averageTimeSeconds,
      } : null,
    };

    if (includeAnswers) {
      formatted.correctAnswers = question.options
        .filter(opt => opt.isCorrect)
        .map(opt => question.options.findIndex(o => o.optionLabel === opt.optionLabel));
    }

    return formatted;
  }

  /**
   * Generate content hash for duplicate detection
   */
  _generateContentHash(questionText, options) {
    const normalizedText = questionText.trim().toLowerCase();
    const normalizedOptions = options
      .map(opt => (opt.text || opt.optionText).trim().toLowerCase())
      .sort()
      .join('|');

    return crypto
      .createHash('sha256')
      .update(normalizedText + normalizedOptions)
      .digest('hex');
  }
}

module.exports = new QuestionRepository();
