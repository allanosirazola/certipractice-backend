const QuestionService = require('../services/questionService');
const ExamService = require('../services/examService');
const UserService = require('../services/userService');
const logger = require('../utils/logger');

const getGlobalStats = async (req, res) => {
  try {
    // This is a simple implementation
    // In a real database, you'd use aggregation queries
    const questions = await QuestionService.loadQuestions();
    const exams = await ExamService.loadExams();
    
    const totalQuestions = questions.length;
    const totalExams = exams.length;
    const completedExams = exams.filter(e => e.status === 'completed').length;
    
    const providerStats = questions.reduce((acc, q) => {
      acc[q.provider] = (acc[q.provider] || 0) + 1;
      return acc;
    }, {});

    const difficultyStats = questions.reduce((acc, q) => {
      acc[q.difficulty] = (acc[q.difficulty] || 0) + 1;
      return acc;
    }, {});

    const categoryStats = questions.reduce((acc, q) => {
      acc[q.category] = (acc[q.category] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        totalQuestions,
        totalExams,
        completedExams,
        providerStats,
        difficultyStats,
        categoryStats
      }
    });
  } catch (error) {
    logger.error('Get global stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

const getQuestionStats = async (req, res) => {
  try {
    const questions = await QuestionService.loadQuestions();
    
    const stats = questions.map(q => ({
      id: q.id,
      text: q.text.substring(0, 100) + '...',
      category: q.category,
      provider: q.provider,
      difficulty: q.difficulty,
      totalAttempts: q.stats.totalAttempts,
      correctAttempts: q.stats.correctAttempts,
      correctPercentage: q.getCorrectPercentage(),
      averageTime: q.stats.averageTime
    }));

    // Sort by total attempts descending
    stats.sort((a, b) => b.totalAttempts - a.totalAttempts);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Get question stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

module.exports = {
  getGlobalStats,
  getQuestionStats
};