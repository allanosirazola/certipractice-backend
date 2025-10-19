// src/models/Question.js - Updated for PostgreSQL schema
class Question {
  constructor(data) {
    // Primary identifiers
    this.id = data.id;
    this.externalId = data.externalId || data.external_id;
    
    // Content
    this.text = data.text || data.question_text;
    this.options = data.options || [];
    this.correctAnswers = data.correctAnswers || [];
    this.explanation = data.explanation;
    
    // Classification
    this.category = data.category || data.topic_name;
    this.subcategory = data.subcategory;
    this.provider = data.provider || data.provider_name;
    this.certification = data.certification || data.certification_name;
    this.certificationCode = data.certificationCode || data.certification_code;
    this.difficulty = data.difficulty || data.difficulty_level || 'medium';
    this.tags = data.tags || [];
    
    // Question properties
    this.questionType = data.questionType || data.question_type || 'multiple_choice';
    this.questionTypeDisplay = data.questionTypeDisplay || data.question_type_display;
    this.expectedAnswers = data.expectedAnswers || data.expected_answers_count || 1;
    this.points = parseFloat(data.points) || 1.0;
    this.isMultipleChoice = data.isMultipleChoice !== undefined ? 
      data.isMultipleChoice : (this.expectedAnswers > 1);
    
    // Status and metadata
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    this.reviewStatus = data.reviewStatus || data.review_status || 'pending';
    this.createdAt = data.createdAt || data.created_at || new Date().toISOString();
    this.updatedAt = data.updatedAt || data.updated_at || new Date().toISOString();
    
    // Statistics
    this.stats = data.stats || {
      totalAttempts: data.total_attempts || 0,
      correctAttempts: data.correct_attempts || 0,
      averageTime: data.average_time_seconds || data.average_time || 0,
      successRate: data.success_rate || 0
    };
  }

  static validate(data) {
    const errors = [];

    // Required fields validation
    if (!data.text || data.text.trim().length === 0) {
      errors.push('Question text is required');
    }

    if (data.text && data.text.length > 5000) {
      errors.push('Question text is too long (max 5000 characters)');
    }

    if (!data.options || !Array.isArray(data.options) || data.options.length < 2) {
      errors.push('At least 2 options are required');
    }

    if (data.options && data.options.length > 8) {
      errors.push('Maximum 8 options allowed');
    }

    if (!data.correctAnswers || !Array.isArray(data.correctAnswers) || data.correctAnswers.length === 0) {
      errors.push('At least one correct answer is required');
    }

    if (!data.category && !data.topic_name) {
      errors.push('Category/Topic is required');
    }

    if (!data.provider && !data.provider_name) {
      errors.push('Provider is required');
    }

    // Multiple choice validation
    if (data.isMultipleChoice || data.expectedAnswers > 1) {
      if (data.correctAnswers && data.correctAnswers.length === 1) {
        errors.push('Multiple choice questions must have more than one correct answer');
      }
      
      if (data.expectedAnswers && data.correctAnswers && 
          data.expectedAnswers !== data.correctAnswers.length) {
        errors.push('Expected answers count must match the number of correct answers');
      }
      
      if (data.options && data.correctAnswers && 
          data.correctAnswers.length >= data.options.length) {
        errors.push('Multiple choice questions must have at least one incorrect option');
      }
    } else {
      // Single choice validation
      if (data.correctAnswers && data.correctAnswers.length > 1) {
        errors.push('Single choice questions must have exactly one correct answer');
      }
      
      if (data.expectedAnswers && data.expectedAnswers !== 1) {
        errors.push('Single choice questions must expect exactly 1 answer');
      }
    }

    // Validate correct answer indices
    if (data.options && data.correctAnswers) {
      const maxIndex = data.options.length - 1;
      for (const index of data.correctAnswers) {
        if (!Number.isInteger(index) || index < 0 || index > maxIndex) {
          errors.push(`Invalid correct answer index: ${index}`);
        }
      }
    }

    // Validate difficulty
    const validDifficulties = ['easy', 'medium', 'hard', 'expert'];
    if (data.difficulty && !validDifficulties.includes(data.difficulty)) {
      errors.push(`Difficulty must be one of: ${validDifficulties.join(', ')}`);
    }

    // Validate expected answers
    if (data.expectedAnswers && (data.expectedAnswers < 1 || data.expectedAnswers > 8)) {
      errors.push('Expected answers must be between 1 and 8');
    }

    // Validate points
    if (data.points !== undefined && (data.points < 0.1 || data.points > 100)) {
      errors.push('Points must be between 0.1 and 100');
    }

    // Validate question type
    const validTypes = ['multiple_choice', 'multiple_answer', 'true_false', 'fill_blank', 'essay', 'matching', 'ordering'];
    if (data.questionType && !validTypes.includes(data.questionType)) {
      errors.push(`Question type must be one of: ${validTypes.join(', ')}`);
    }

    return errors;
  }

  getCorrectPercentage() {
    if (this.stats.totalAttempts === 0) return 0;
    return Math.round((this.stats.correctAttempts / this.stats.totalAttempts) * 100);
  }

  getSuccessRate() {
    return this.stats.successRate || this.getCorrectPercentage();
  }

  // Check if a user answer is correct
  isAnswerCorrect(userAnswer) {
    if (this.isMultipleChoice) {
      if (!Array.isArray(userAnswer)) {
        return false;
      }
      
      // Check that the number of answers matches expected
      if (userAnswer.length !== this.correctAnswers.length) {
        return false;
      }
      
      // Sort both arrays and compare
      const sortedUserAnswer = [...userAnswer].sort((a, b) => a - b);
      const sortedCorrectAnswers = [...this.correctAnswers].sort((a, b) => a - b);
      
      return JSON.stringify(sortedUserAnswer) === JSON.stringify(sortedCorrectAnswers);
    } else {
      // For single choice questions
      const answer = Array.isArray(userAnswer) ? userAnswer[0] : userAnswer;
      return this.correctAnswers.includes(answer);
    }
  }

  // Get options with correctness information
  getOptionsWithCorrectness() {
    return this.options.map((option, index) => ({
      ...option,
      index: index,
      isCorrect: this.correctAnswers.includes(index)
    }));
  }

  // Get question metadata without sensitive information
  getMetadata() {
    return {
      id: this.id,
      externalId: this.externalId,
      category: this.category,
      subcategory: this.subcategory,
      provider: this.provider,
      certification: this.certification,
      certificationCode: this.certificationCode,
      difficulty: this.difficulty,
      tags: this.tags,
      questionType: this.questionType,
      questionTypeDisplay: this.questionTypeDisplay,
      isMultipleChoice: this.isMultipleChoice,
      expectedAnswers: this.expectedAnswers,
      points: this.points,
      optionCount: this.options.length,
      correctAnswerCount: this.correctAnswers.length,
      hasExplanation: !!this.explanation,
      reviewStatus: this.reviewStatus,
      isActive: this.isActive,
      stats: this.stats,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // Get sanitized version (without correct answers)
  getSanitized() {
    return {
      id: this.id,
      externalId: this.externalId,
      text: this.text,
      options: this.options.map(option => ({
        label: option.label,
        text: option.text
        // Don't include explanation for options in sanitized version
      })),
      category: this.category,
      subcategory: this.subcategory,
      provider: this.provider,
      certification: this.certification,
      certificationCode: this.certificationCode,
      difficulty: this.difficulty,
      tags: this.tags,
      questionType: this.questionType,
      questionTypeDisplay: this.questionTypeDisplay,
      isMultipleChoice: this.isMultipleChoice,
      expectedAnswers: this.expectedAnswers,
      points: this.points,
      createdAt: this.createdAt,
      // Don't include: correctAnswers, explanation, stats (for security)
    };
  }

  // Get complete version (with all information)
  getComplete() {
    return {
      id: this.id,
      externalId: this.externalId,
      text: this.text,
      options: this.options,
      correctAnswers: this.correctAnswers,
      explanation: this.explanation,
      category: this.category,
      subcategory: this.subcategory,
      provider: this.provider,
      certification: this.certification,
      certificationCode: this.certificationCode,
      difficulty: this.difficulty,
      tags: this.tags,
      questionType: this.questionType,
      questionTypeDisplay: this.questionTypeDisplay,
      isMultipleChoice: this.isMultipleChoice,
      expectedAnswers: this.expectedAnswers,
      points: this.points,
      reviewStatus: this.reviewStatus,
      isActive: this.isActive,
      stats: this.stats,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // Get answer result with explanation
  getAnswerResult(userAnswer) {
    const isCorrect = this.isAnswerCorrect(userAnswer);
    
    return {
      questionId: this.id,
      isCorrect: isCorrect,
      correctAnswers: this.correctAnswers,
      explanation: this.explanation,
      userAnswer: userAnswer,
      points: isCorrect ? this.points : 0,
      options: this.getOptionsWithCorrectness()
    };
  }

  // Update statistics
  updateStats(isCorrect, timeSpent) {
    this.stats.totalAttempts++;
    if (isCorrect) {
      this.stats.correctAttempts++;
    }
    
    // Calculate average time
    if (timeSpent > 0) {
      const totalTime = this.stats.averageTime * (this.stats.totalAttempts - 1) + timeSpent;
      this.stats.averageTime = Math.round(totalTime / this.stats.totalAttempts);
    }
    
    // Update success rate
    this.stats.successRate = this.getCorrectPercentage();
    
    this.updatedAt = new Date().toISOString();
  }

  // Get calculated difficulty based on statistics
  getCalculatedDifficulty() {
    const successRate = this.getSuccessRate();
    
    if (successRate >= 80) return 'easy';
    if (successRate >= 60) return 'medium';
    if (successRate >= 30) return 'hard';
    return 'expert';
  }

  // Validate options format
  static validateOptions(options) {
    const errors = [];
    
    if (!Array.isArray(options)) {
      errors.push('Options must be an array');
      return errors;
    }
    
    if (options.length < 2) {
      errors.push('At least 2 options are required');
      return errors;
    }
    
    if (options.length > 8) {
      errors.push('Maximum 8 options allowed');
    }
    
    options.forEach((option, index) => {
      if (!option.text || option.text.trim().length === 0) {
        errors.push(`Option ${index + 1} text is required`);
      }
      
      if (option.text && option.text.length > 1000) {
        errors.push(`Option ${index + 1} text is too long (max 1000 characters)`);
      }
      
      if (option.explanation && option.explanation.length > 500) {
        errors.push(`Option ${index + 1} explanation is too long (max 500 characters)`);
      }
    });
    
    // Check for duplicate options
    const optionTexts = options.map(opt => opt.text?.trim().toLowerCase()).filter(Boolean);
    const uniqueTexts = new Set(optionTexts);
    if (uniqueTexts.size !== optionTexts.length) {
      errors.push('Duplicate options are not allowed');
    }
    
    return errors;
  }

  // Convert to exam format for frontend
  toExamFormat() {
    return {
      id: this.id,
      text: this.text,
      options: this.options.map(option => ({
        label: option.label,
        text: option.text
      })),
      category: this.category,
      provider: this.provider,
      certification: this.certification,
      certificationCode: this.certificationCode,
      difficulty: this.difficulty,
      questionType: this.questionType,
      isMultipleChoice: this.isMultipleChoice,
      expectedAnswers: this.expectedAnswers,
      points: this.points
      // Don't include correctAnswers or explanation for exam mode
    };
  }

  // Convert to review format for admins
  toReviewFormat() {
    return {
      ...this.getComplete(),
      validationErrors: Question.validate(this.getComplete()),
      optionErrors: Question.validateOptions(this.options),
      calculatedDifficulty: this.getCalculatedDifficulty(),
      isValid: this.isValid()
    };
  }

  // Check if question is valid
  isValid() {
    const errors = Question.validate(this.getComplete());
    const optionErrors = Question.validateOptions(this.options);
    return errors.length === 0 && optionErrors.length === 0;
  }

  // Get difficulty color for UI
  getDifficultyColor() {
    const colors = {
      easy: '#28a745',
      medium: '#ffc107', 
      hard: '#fd7e14',
      expert: '#dc3545'
    };
    return colors[this.difficulty] || colors.medium;
  }

  // Get question type icon
  getQuestionTypeIcon() {
    const icons = {
      multiple_choice: '◦',
      multiple_answer: '☑',
      true_false: '⚖',
      fill_blank: '___',
      essay: '📝',
      matching: '⟷',
      ordering: '📶'
    };
    return icons[this.questionType] || '❓';
  }

  // Convert to database format for saving
  toDatabaseFormat() {
    return {
      external_id: this.externalId,
      question_text: this.text,
      explanation: this.explanation,
      difficulty_level: this.difficulty,
      expected_answers_count: this.expectedAnswers,
      points: this.points,
      review_status: this.reviewStatus,
      is_active: this.isActive
    };
  }

  // Create from database row
  static fromDatabaseRow(row) {
    return new Question({
      id: row.id,
      externalId: row.external_id,
      text: row.question_text,
      explanation: row.explanation,
      difficulty: row.difficulty_level,
      expectedAnswers: row.expected_answers_count,
      points: row.points,
      reviewStatus: row.review_status,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Add other mapped fields as needed
    });
  }

  // Clone question for editing
  clone() {
    return new Question(this.getComplete());
  }

  // Export to JSON
  toJSON() {
    return this.getComplete();
  }
}

module.exports = Question;