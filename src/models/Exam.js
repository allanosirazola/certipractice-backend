class Exam {
  constructor(data) {
    this.id = data.id;
    this.userId = data.userId; // null para usuarios anónimos
    this.sessionId = data.sessionId; // para usuarios anónimos
    this.title = data.title;
    this.description = data.description;
    this.provider = data.provider;
    this.certification = data.certification;
    this.questions = data.questions || [];
    this.answers = data.answers || {};
    this.timeLimit = data.timeLimit || 120; // minutes
    this.timeSpent = data.timeSpent || 0;
    this.status = data.status || 'not_started'; // not_started, in_progress, paused, completed, cancelled
    this.score = data.score || 0;
    this.passed = data.passed || false;
    this.passingScore = data.passingScore || 70;
    this.startedAt = data.startedAt;
    this.completedAt = data.completedAt;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.settings = data.settings || {
      showExplanations: true,
      randomizeQuestions: false,
      randomizeAnswers: false
    };
    // Nuevos campos para estadísticas
    this.totalQuestions = data.totalQuestions || this.questions.length;
    this.correctAnswers = data.correctAnswers || 0;
    this.incorrectAnswers = data.incorrectAnswers || 0;
  }
  calculateScore() {
    if (this.questions.length === 0) return 0;
    
    let correctCount = 0;
    this.questions.forEach(question => {
      const userAnswer = this.answers[question.id];
      if (userAnswer !== undefined && this.isAnswerCorrect(question, userAnswer)) {
        correctCount++;
      }
    });

    this.score = Math.round((correctCount / this.questions.length) * 100);
    this.passed = this.score >= this.passingScore;
    this.correctAnswers = correctCount;
    this.incorrectAnswers = this.questions.length - correctCount;
    return this.score;
  }

  // ACTUALIZADO: Mejorar la validación de respuestas múltiples para PostgreSQL
  isAnswerCorrect(question, userAnswer) {
    // Validar que la pregunta tenga respuestas correctas
    if (!question.correctAnswers || question.correctAnswers.length === 0) {
      return false;
    }

    if (question.isMultipleChoice || question.questionType === 'multiple_answer') {
      // Para preguntas de selección múltiple
      if (!Array.isArray(userAnswer)) {
        return false;
      }
      
      // Verificar que el número de respuestas coincida
      if (userAnswer.length !== question.correctAnswers.length) {
        return false;
      }
      
      // Ordenar ambos arrays y compararlos
      const sortedUserAnswer = userAnswer.map(a => parseInt(a)).sort((a, b) => a - b);
      const sortedCorrectAnswers = question.correctAnswers.map(a => parseInt(a)).sort((a, b) => a - b);
      
      return JSON.stringify(sortedUserAnswer) === JSON.stringify(sortedCorrectAnswers);
    } else {
      // Para preguntas de respuesta única
      if (Array.isArray(userAnswer)) {
        // Si el usuario envió un array para pregunta única, tomar solo el primer elemento
        return question.correctAnswers.includes(userAnswer[0]);
      } else {
        return question.correctAnswers.includes(userAnswer);
      }
    }
  }

  // ACTUALIZADO: Mejorar el cálculo de resultados para PostgreSQL
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
      partiallyCorrect: 0,
      timeSpent: this.timeSpent,
      timeLimit: this.timeLimit,
      efficiency: 0, // Preguntas correctas por minuto
      questionResults: [],
      // Estadísticas por tipo de pregunta
      multipleChoiceStats: {
        total: 0,
        correct: 0,
        incorrect: 0,
        unanswered: 0
      },
      singleChoiceStats: {
        total: 0,
        correct: 0,
        incorrect: 0,
        unanswered: 0
      },
      // Estadísticas por dificultad
      difficultyStats: {
        easy: { total: 0, correct: 0 },
        medium: { total: 0, correct: 0 },
        hard: { total: 0, correct: 0 },
        expert: { total: 0, correct: 0 }
      },
      // Estadísticas por categoría/tema
      categoryStats: {}
    };

    this.questions.forEach(question => {
      const userAnswer = this.answers[question.id];
      const isAnswered = userAnswer !== undefined;
      const isCorrect = isAnswered ? this.isAnswerCorrect(question, userAnswer) : false;
      
      // Actualizar contadores generales
      if (isCorrect) {
        results.correctAnswers++;
      } else if (isAnswered) {
        results.incorrectAnswers++;
      } else {
        results.unansweredQuestions++;
      }

      // Actualizar estadísticas por tipo
      const isMultiple = question.isMultipleChoice || question.questionType === 'multiple_answer';
      const typeStats = isMultiple ? results.multipleChoiceStats : results.singleChoiceStats;
      
      typeStats.total++;
      if (isCorrect) {
        typeStats.correct++;
      } else if (isAnswered) {
        typeStats.incorrect++;
      } else {
        typeStats.unanswered++;
      }

      // Actualizar estadísticas por dificultad
      const difficulty = question.difficulty || 'medium';
      if (results.difficultyStats[difficulty]) {
        results.difficultyStats[difficulty].total++;
        if (isCorrect) {
          results.difficultyStats[difficulty].correct++;
        }
      }

      // Actualizar estadísticas por categoría
      const category = question.category || 'General';
      if (!results.categoryStats[category]) {
        results.categoryStats[category] = { total: 0, correct: 0 };
      }
      results.categoryStats[category].total++;
      if (isCorrect) {
        results.categoryStats[category].correct++;
      }

      // Calcular respuesta parcialmente correcta para preguntas múltiples
      let partialScore = 0;
      if (isMultiple && userAnswer && Array.isArray(userAnswer)) {
        const correctCount = userAnswer.filter(answer => question.correctAnswers.includes(answer)).length;
        const incorrectCount = userAnswer.filter(answer => !question.correctAnswers.includes(answer)).length;
        
        // Puntuación parcial: (correctas - incorrectas) / total_correctas, mínimo 0
        partialScore = Math.max(0, (correctCount - incorrectCount) / question.correctAnswers.length);
        
        if (partialScore > 0 && partialScore < 1) {
          results.partiallyCorrect++;
        }
      }

      results.questionResults.push({
        questionId: question.id,
        questionText: question.text,
        questionType: question.questionType || (isMultiple ? 'multiple_answer' : 'multiple_choice'),
        difficulty: difficulty,
        category: category,
        userAnswer: userAnswer,
        correctAnswers: question.correctAnswers,
        isAnswered: isAnswered,
        isCorrect: isCorrect,
        partialScore: partialScore,
        explanation: question.explanation,
        timeSpent: question.timeSpent || 0,
        expectedAnswers: question.expectedAnswers || 1,
        // Información detallada de la respuesta
        answerDetails: this.getAnswerDetails(question, userAnswer)
      });
    });

    // Calcular eficiencia (preguntas correctas por minuto)
    if (this.timeSpent > 0) {
      results.efficiency = Math.round((results.correctAnswers / this.timeSpent) * 100) / 100;
    }

    // Calcular porcentajes para cada categoría
    Object.keys(results.categoryStats).forEach(category => {
      const stats = results.categoryStats[category];
      stats.percentage = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    });

    // Calcular porcentajes para dificultades
    Object.keys(results.difficultyStats).forEach(difficulty => {
      const stats = results.difficultyStats[difficulty];
      stats.percentage = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    });

    return results;
  }

  // ACTUALIZADO: Obtener detalles de la respuesta compatible con PostgreSQL
  getAnswerDetails(question, userAnswer) {
    if (!question.options || question.options.length === 0) {
      return null;
    }

    const details = {
      selectedOptions: [],
      correctOptions: [],
      incorrectlySelected: [],
      missedCorrect: []
    };

    // Mapear respuestas correctas a opciones
    question.correctAnswers.forEach(index => {
      if (question.options[index]) {
        details.correctOptions.push({
          index: index,
          label: question.options[index].label || String.fromCharCode(65 + index), // A, B, C, D...
          text: question.options[index].text
        });
      }
    });

    if (userAnswer !== undefined) {
      const userAnswerArray = Array.isArray(userAnswer) ? userAnswer : [userAnswer];
      
      // Mapear respuestas del usuario
      userAnswerArray.forEach(index => {
        if (question.options[index]) {
          const option = {
            index: index,
            label: question.options[index].label || String.fromCharCode(65 + index),
            text: question.options[index].text,
            isCorrect: question.correctAnswers.includes(index)
          };
          
          details.selectedOptions.push(option);
          
          if (!option.isCorrect) {
            details.incorrectlySelected.push(option);
          }
        }
      });

      // Encontrar respuestas correctas no seleccionadas
      question.correctAnswers.forEach(index => {
        if (!userAnswerArray.includes(index) && question.options[index]) {
          details.missedCorrect.push({
            index: index,
            label: question.options[index].label || String.fromCharCode(65 + index),
            text: question.options[index].text
          });
        }
      });
    } else {
      // No respondida: todas las correctas son "perdidas"
      details.missedCorrect = [...details.correctOptions];
    }

    return details;
  }

  static validate(data) {
    const errors = [];

    // Solo validar que tenemos provider y certification
    if (!data.provider) {
      errors.push('Provider is required');
    }

    if (!data.certification) {
      errors.push('Certification is required');
    }

    // Validaciones opcionales - si se proporcionan, deben ser válidas
    if (data.timeLimit && (isNaN(data.timeLimit) || data.timeLimit < 1)) {
      errors.push('Time limit must be a positive number');
    }

    if (data.questionCount && (isNaN(data.questionCount) || data.questionCount < 1)) {
      errors.push('Question count must be a positive number');
    }

    if (data.passingScore && (isNaN(data.passingScore) || data.passingScore < 0 || data.passingScore > 100)) {
      errors.push('Passing score must be between 0 and 100');
    }

    if (data.mode && !['practice', 'realistic', 'timed', 'simulation', 'review'].includes(data.mode)) {
      errors.push('Invalid exam mode');
    }

    return errors;
  }

  // Método para verificar si el examen pertenece al usuario/sesión
  belongsTo(userId, sessionId) {
    if (userId && this.userId) {
      return this.userId === userId;
    }
    if (sessionId && this.sessionId) {
      return this.sessionId === sessionId;
    }
    return false;
  }

  // Método para determinar si es un examen anónimo
  isAnonymous() {
    return !this.userId && this.sessionId;
  }

  // ACTUALIZADO: Obtener progreso del examen con información de PostgreSQL
  getProgress() {
    const totalQuestions = this.questions.length;
    const answeredQuestions = Object.keys(this.answers).length;
    
    // Calcular progreso por estado de respuesta
    let correctAnswers = 0;
    let incorrectAnswers = 0;
    
    this.questions.forEach(question => {
      const userAnswer = this.answers[question.id];
      if (userAnswer !== undefined) {
        if (this.isAnswerCorrect(question, userAnswer)) {
          correctAnswers++;
        } else {
          incorrectAnswers++;
        }
      }
    });
    
    return {
      totalQuestions: totalQuestions,
      answeredQuestions: answeredQuestions,
      correctAnswers: correctAnswers,
      incorrectAnswers: incorrectAnswers,
      remainingQuestions: totalQuestions - answeredQuestions,
      progressPercentage: totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0,
      accuracyPercentage: answeredQuestions > 0 ? Math.round((correctAnswers / answeredQuestions) * 100) : 0,
      // Progreso por tipo de pregunta
      multipleChoiceProgress: this.getProgressByType(true),
      singleChoiceProgress: this.getProgressByType(false),
      // Progreso por dificultad
      difficultyProgress: this.getProgressByDifficulty()
    };
  }

  // ACTUALIZADO: Obtener progreso por tipo de pregunta
  getProgressByType(isMultipleChoice) {
    const questionsOfType = this.questions.filter(q => 
      q.isMultipleChoice === isMultipleChoice || 
      (isMultipleChoice && q.questionType === 'multiple_answer') ||
      (!isMultipleChoice && q.questionType === 'multiple_choice')
    );
    const answeredOfType = questionsOfType.filter(q => this.answers[q.id] !== undefined);
    
    return {
      total: questionsOfType.length,
      answered: answeredOfType.length,
      remaining: questionsOfType.length - answeredOfType.length,
      percentage: questionsOfType.length > 0 ? Math.round((answeredOfType.length / questionsOfType.length) * 100) : 0
    };
  }

  // NUEVO: Obtener progreso por dificultad
  getProgressByDifficulty() {
    const difficulties = ['easy', 'medium', 'hard', 'expert'];
    const progress = {};
    
    difficulties.forEach(difficulty => {
      const questionsOfDifficulty = this.questions.filter(q => q.difficulty === difficulty);
      const answeredOfDifficulty = questionsOfDifficulty.filter(q => this.answers[q.id] !== undefined);
      
      progress[difficulty] = {
        total: questionsOfDifficulty.length,
        answered: answeredOfDifficulty.length,
        remaining: questionsOfDifficulty.length - answeredOfDifficulty.length,
        percentage: questionsOfDifficulty.length > 0 ? 
          Math.round((answeredOfDifficulty.length / questionsOfDifficulty.length) * 100) : 0
      };
    });
    
    return progress;
  }

  // ACTUALIZADO: Validar respuesta antes de guardarla (compatible con PostgreSQL)
  validateAnswer(questionId, answer) {
    const question = this.questions.find(q => q.id === questionId);
    
    if (!question) {
      throw new Error('Question not found in exam');
    }

    const isMultiple = question.isMultipleChoice || question.questionType === 'multiple_answer';

    // Validar formato de respuesta
    if (isMultiple) {
      if (!Array.isArray(answer)) {
        throw new Error('Multiple choice questions require array answers');
      }
      
      if (answer.length === 0) {
        throw new Error('At least one answer must be selected for multiple choice questions');
      }
      
      if (question.expectedAnswers && answer.length > question.expectedAnswers) {
        throw new Error(`Too many answers selected. Expected maximum: ${question.expectedAnswers}`);
      }
      
      // Validar que todos los índices sean válidos
      const maxIndex = question.options.length - 1;
      for (const index of answer) {
        if (!Number.isInteger(index) || index < 0 || index > maxIndex) {
          throw new Error(`Invalid answer index: ${index}`);
        }
      }
      
      // Eliminar duplicados
      answer = [...new Set(answer)];
    } else {
      // Pregunta de respuesta única
      if (Array.isArray(answer)) {
        if (answer.length !== 1) {
          throw new Error('Single choice questions require exactly one answer');
        }
        // Convertir array de un elemento a valor único
        answer = answer[0];
      }
      
      if (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length) {
        throw new Error(`Invalid answer index: ${answer}`);
      }
    }

    return answer; // Devolver respuesta validada (posiblemente modificada)
  }

  // ACTUALIZADO: Obtener tiempo restante en segundos con soporte para PostgreSQL
  getTimeRemaining() {
    if (this.status !== 'in_progress' || !this.startedAt) {
      return 0;
    }

    const startTime = new Date(this.startedAt);
    const currentTime = new Date();
    const elapsedMinutes = (currentTime - startTime) / 1000 / 60;
    const remainingMinutes = Math.max(0, this.timeLimit - elapsedMinutes);
    
    return Math.floor(remainingMinutes * 60); // Convertir a segundos
  }

  // Verificar si el examen ha expirado por tiempo
  isTimeExpired() {
    return this.getTimeRemaining() <= 0 && this.status === 'in_progress';
  }

  // ACTUALIZADO: Obtener resumen rápido del examen con datos de PostgreSQL
  getSummary() {
    const progress = this.getProgress();
    
    return {
      id: this.id,
      title: this.title,
      provider: this.provider,
      certification: this.certification,
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
      questionTypes: {
        multipleChoice: progress.multipleChoiceProgress.total,
        singleChoice: progress.singleChoiceProgress.total
      },
      statistics: {
        totalQuestions: this.totalQuestions || this.questions.length,
        correctAnswers: this.correctAnswers || progress.correctAnswers,
        incorrectAnswers: this.incorrectAnswers || progress.incorrectAnswers,
        answeredQuestions: progress.answeredQuestions,
        unansweredQuestions: progress.remainingQuestions
      }
    };
  }

  // NUEVO: Obtener análisis del examen
  getAnalysis() {
    const results = this.getResults();
    const recommendations = [];
    const strengths = [];
    const weaknesses = [];

    // Analizar rendimiento por categoría
    Object.entries(results.categoryStats).forEach(([category, stats]) => {
      if (stats.percentage >= 80) {
        strengths.push(`Excellent performance in ${category} (${stats.percentage}%)`);
      } else if (stats.percentage < 60) {
        weaknesses.push(`Needs improvement in ${category} (${stats.percentage}%)`);
        recommendations.push(`Focus more study time on ${category} topics`);
      }
    });

    // Analizar rendimiento por dificultad
    Object.entries(results.difficultyStats).forEach(([difficulty, stats]) => {
      if (stats.total > 0 && stats.percentage < 50) {
        weaknesses.push(`Struggling with ${difficulty} questions (${stats.percentage}%)`);
        recommendations.push(`Practice more ${difficulty} level questions`);
      }
    });

    // Analizar tiempo
    if (results.efficiency < 0.5) {
      recommendations.push('Work on answering questions more quickly');
    } else if (results.efficiency > 2) {
      recommendations.push('Take more time to carefully read questions');
    }

    // Analizar tipos de pregunta
    if (results.multipleChoiceStats.total > 0 && 
        (results.multipleChoiceStats.correct / results.multipleChoiceStats.total) < 0.6) {
      weaknesses.push('Difficulty with multiple answer questions');
      recommendations.push('Practice elimination techniques for multiple choice questions');
    }

    return {
      recommendations,
      strengths,
      weaknesses,
      overallPerformance: this.score >= this.passingScore ? 'Passed' : 'Failed',
      readinessLevel: this.score >= this.passingScore * 1.2 ? 'Well Prepared' : 
                     this.score >= this.passingScore ? 'Ready' : 
                     this.score >= this.passingScore * 0.8 ? 'Almost Ready' : 'Needs More Study'
    };
  }

  // NUEVO: Convertir a formato JSON para API
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      sessionId: this.sessionId,
      title: this.title,
      description: this.description,
      provider: this.provider,
      certification: this.certification,
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
      summary: this.getSummary()
    };
  }

  toReviewFormat() {
    return {
      ...this.toJSON(),
      // Asegurar que las preguntas incluyan respuestas correctas
      questions: this.questions.map(question => ({
        ...question,
        correctAnswers: question.correctAnswers || [],
        explanation: question.explanation || 'No explanation available'
      }))
    };
  }
}

module.exports = Exam;