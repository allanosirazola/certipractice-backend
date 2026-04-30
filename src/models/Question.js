/**
 * @fileoverview Question Model
 * Represents a question in the certification exam system
 */

/**
 * Difficulty levels
 */
const Difficulty = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
  EXPERT: 'expert',
};

const AllDifficulties = Object.values(Difficulty);

/**
 * Question types
 */
const QuestionType = {
  MULTIPLE_CHOICE: 'multiple_choice',
  MULTIPLE_ANSWER: 'multiple_answer',
  TRUE_FALSE: 'true_false',
};

/**
 * Review status
 */
const ReviewStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  NEEDS_REVISION: 'needs_revision',
};

/**
 * Question class
 */
class Question {
  /**
   * Create a Question instance
   * @param {Object} data - Question data
   */
  constructor(data = {}) {
    this.id = data.id || null;
    this.externalId = data.external_id || data.externalId || null;
    this.text = data.question_text || data.text || '';
    this.explanation = data.explanation || '';
    this.difficulty = data.difficulty_level || data.difficulty || Difficulty.MEDIUM;
    this.expectedAnswers = data.expected_answers_count || data.expectedAnswers || 1;
    this.points = data.points || 1.0;
    this.isActive = data.is_active ?? data.isActive ?? true;
    this.reviewStatus = data.review_status || data.reviewStatus || ReviewStatus.PENDING;
    this.category = data.category || data.topic_name || '';
    
    // Relationships
    this.topicId = data.topic_id || data.topicId || null;
    this.topicName = data.topic_name || data.topicName || '';
    this.certificationId = data.certification_id || data.certificationId || null;
    this.certificationName = data.certification_name || data.certificationName || '';
    this.certificationCode = data.certification_code || data.certificationCode || '';
    this.providerId = data.provider_id || data.providerId || null;
    this.providerName = data.provider_name || data.providerName || '';
    
    // Question type
    this.questionType = data.question_type || data.questionType || QuestionType.MULTIPLE_CHOICE;
    this.questionTypeDisplay = data.question_type_display || this.getQuestionTypeDisplay();
    
    // Options and answers
    this.options = this.parseOptions(data.options);
    this.correctAnswers = this.parseCorrectAnswers(data.correct_answer_indices || data.correctAnswers);
    
    // Metadata
    this.createdBy = data.created_by || data.createdBy || null;
    this.createdAt = data.created_at || data.createdAt || new Date().toISOString();
    this.updatedAt = data.updated_at || data.updatedAt || new Date().toISOString();
  }

  /**
   * Enums
   */
  static get Difficulty() {
    return Difficulty;
  }

  static get QuestionType() {
    return QuestionType;
  }

  static get ReviewStatus() {
    return ReviewStatus;
  }

  /**
   * Check if difficulty is valid
   * @param {string} difficulty
   * @returns {boolean}
   */
  static isValidDifficulty(difficulty) {
    return Boolean(difficulty && AllDifficulties.includes(difficulty));
  }

  /**
   * Parse options from various formats
   * @param {Array|string} options
   * @returns {Array}
   */
  parseOptions(options) {
    if (!options) return [];
    if (typeof options === 'string') {
      try {
        return JSON.parse(options);
      } catch {
        return [];
      }
    }
    return Array.isArray(options) ? options : [];
  }

  /**
   * Parse correct answers from various formats
   * @param {Array|string} answers
   * @returns {Array}
   */
  parseCorrectAnswers(answers) {
    if (!answers) return [];
    if (typeof answers === 'string') {
      try {
        return JSON.parse(answers);
      } catch {
        return [];
      }
    }
    return Array.isArray(answers) ? answers : [answers];
  }

  /**
   * Get display name for question type
   * @returns {string}
   */
  getQuestionTypeDisplay() {
    const displays = {
      [QuestionType.MULTIPLE_CHOICE]: 'Multiple Choice',
      [QuestionType.MULTIPLE_ANSWER]: 'Multiple Answer',
      [QuestionType.TRUE_FALSE]: 'True/False',
    };
    return displays[this.questionType] || 'Multiple Choice';
  }

  /**
   * Check if this is a multiple answer question
   * @returns {boolean}
   */
  get isMultipleChoice() {
    return this.questionType === QuestionType.MULTIPLE_ANSWER || 
           this.expectedAnswers > 1 ||
           this.correctAnswers.length > 1;
  }

  /**
   * Alias for isMultipleChoice
   * @returns {boolean}
   */
  isMultipleAnswer() {
    return this.isMultipleChoice;
  }

  /**
   * Validate question data
   * @param {Object} data - Question data
   * @returns {Array} - Array of validation errors
   */
  static validate(data) {
    const errors = [];

    // Text validation
    if (!data.text || typeof data.text !== 'string') {
      errors.push('Question text is required');
    } else if (data.text.length < 10) {
      errors.push('Question text must be at least 10 characters');
    } else if (data.text.length > 5000) {
      errors.push('Question text cannot exceed 5000 characters');
    }

    // Options validation
    if (!data.options || !Array.isArray(data.options)) {
      errors.push('Options are required');
    } else {
      if (data.options.length < 2) {
        errors.push('At least 2 options are required');
      }
      if (data.options.length > 10) {
        errors.push('Maximum 10 options allowed');
      }
      
      // Validate each option and check for unique labels
      const labels = new Set();
      data.options.forEach((option, index) => {
        if (!option.text || typeof option.text !== 'string') {
          errors.push(`Option ${index + 1} text is required`);
        }
        if (!option.label) {
          errors.push(`Option ${index + 1} label is required`);
        } else {
          if (labels.has(option.label)) {
            errors.push('Option labels must be unique');
          }
          labels.add(option.label);
        }
      });
    }

    // Correct answers validation
    if (!data.correctAnswers || !Array.isArray(data.correctAnswers)) {
      errors.push('Correct answers are required');
    } else {
      if (data.correctAnswers.length < 1) {
        errors.push('At least one correct answer is required');
      }
      
      // Validate answer indices
      if (data.options) {
        data.correctAnswers.forEach(index => {
          if (index < 0 || index >= data.options.length) {
            errors.push(`Invalid correct answer index: ${index}`);
          }
        });
      }
    }

    // Difficulty validation
    if (data.difficulty && !AllDifficulties.includes(data.difficulty)) {
      errors.push(`Difficulty must be one of: ${AllDifficulties.join(', ')}`);
    }

    // Points validation
    if (data.points !== undefined) {
      if (typeof data.points !== 'number' || data.points < 0) {
        errors.push('Points must be a positive number');
      }
      if (data.points > 10) {
        errors.push('Points cannot exceed 10');
      }
    }

    // Certification validation
    if (!data.certificationId) {
      errors.push('Certification is required');
    }

    return errors;
  }

  /**
   * Check if answer is correct
   * @param {number|Array} answer - User's answer
   * @returns {boolean}
   */
  isCorrect(answer) {
    if (!this.correctAnswers || this.correctAnswers.length === 0) {
      return false;
    }

    const userAnswers = Array.isArray(answer) ? answer : [answer];
    
    if (userAnswers.length !== this.correctAnswers.length) {
      return false;
    }

    const sortedUser = [...userAnswers].sort((a, b) => a - b);
    const sortedCorrect = [...this.correctAnswers].sort((a, b) => a - b);

    return sortedUser.every((val, idx) => val === sortedCorrect[idx]);
  }

  /**
   * Get correct option labels
   * @returns {Array<string>}
   */
  getCorrectOptionLabels() {
    return this.correctAnswers.map(index => this.options[index]?.label).filter(Boolean);
  }

  /**
   * Shuffle options (updates correctAnswers accordingly)
   */
  shuffle() {
    // Map correct answers to their text
    const correctTexts = this.correctAnswers.map(i => this.options[i]?.text);
    
    // Fisher-Yates shuffle
    const shuffled = [...this.options];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    this.options = shuffled;
    
    // Update correct answers to new indices
    this.correctAnswers = correctTexts
      .map(text => shuffled.findIndex(opt => opt.text === text))
      .filter(i => i >= 0);
  }

  /**
   * Get options without revealing correct answers (for exam)
   * @returns {Array}
   */
  getOptionsForExam() {
    return this.options.map(opt => ({
      label: opt.label,
      text: opt.text,
    }));
  }

  /**
   * Convert to exam format (no answers shown)
   * @param {Object} options
   * @returns {Object}
   */
  toExamFormat(options = {}) {
    const result = {
      id: this.id,
      text: this.text,
      options: this.getOptionsForExam(),
      isMultipleChoice: this.isMultipleChoice,
      expectedAnswers: this.expectedAnswers,
    };

    if (options.includeMetadata) {
      result.difficulty = this.difficulty;
      result.category = this.category;
    }

    return result;
  }

  /**
   * Convert to review format (with answers and explanation)
   * @returns {Object}
   */
  toReviewFormat() {
    return {
      id: this.id,
      text: this.text,
      options: this.options,
      correctAnswers: this.correctAnswers,
      correctLabels: this.getCorrectOptionLabels(),
      explanation: this.explanation,
      difficulty: this.difficulty,
      category: this.category,
      isMultipleChoice: this.isMultipleChoice,
    };
  }

  /**
   * Convert to JSON (safe for API response)
   * @param {boolean} includeAnswers - Include correct answers
   * @returns {Object}
   */
  toJSON(includeAnswers = false) {
    const json = {
      id: this.id,
      externalId: this.externalId,
      text: this.text,
      explanation: includeAnswers ? this.explanation : undefined,
      difficulty: this.difficulty,
      expectedAnswers: this.expectedAnswers,
      points: this.points,
      isActive: this.isActive,
      reviewStatus: this.reviewStatus,
      topicName: this.topicName,
      certificationName: this.certificationName,
      certificationCode: this.certificationCode,
      providerName: this.providerName,
      questionType: this.questionType,
      questionTypeDisplay: this.questionTypeDisplay,
      options: this.getOptionsForExam(),
      isMultipleChoice: this.isMultipleChoice,
    };

    if (includeAnswers) {
      json.correctAnswers = this.correctAnswers;
    }

    return json;
  }

  /**
   * Create a deep clone of this question
   * @returns {Question}
   */
  clone() {
    return new Question({
      id: this.id,
      question_text: this.text,
      explanation: this.explanation,
      difficulty_level: this.difficulty,
      expected_answers_count: this.expectedAnswers,
      points: this.points,
      is_active: this.isActive,
      review_status: this.reviewStatus,
      topic_id: this.topicId,
      topic_name: this.topicName,
      certification_id: this.certificationId,
      certification_name: this.certificationName,
      question_type: this.questionType,
      options: JSON.parse(JSON.stringify(this.options)),
      correct_answer_indices: [...this.correctAnswers],
      category: this.category,
    });
  }

  /**
   * Convert to database format
   * @returns {Object}
   */
  toDatabase() {
    return {
      external_id: this.externalId,
      question_text: this.text,
      explanation: this.explanation,
      difficulty_level: this.difficulty,
      expected_answers_count: this.expectedAnswers,
      points: this.points,
      is_active: this.isActive,
      review_status: this.reviewStatus,
      topic_id: this.topicId,
      certification_id: this.certificationId,
      question_type: this.questionType,
      options: JSON.stringify(this.options),
      correct_answer_indices: JSON.stringify(this.correctAnswers),
      created_by: this.createdBy,
    };
  }
}

module.exports = Question;
