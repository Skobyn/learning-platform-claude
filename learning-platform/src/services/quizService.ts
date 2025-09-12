import db from '@/lib/db';
import crypto from 'crypto';

export interface QuizCreationData {
  moduleId: string;
  title: string;
  description: string;
  passingScore: number;
  timeLimit?: number;
  maxAttempts: number;
  showResultsImmediately: boolean;
  allowReview: boolean;
  questions: QuizQuestionData[];
}

export interface QuizQuestionData {
  text: string;
  type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'FILL_BLANK' | 'ESSAY';
  options?: string[];
  correctAnswer: any;
  explanation: string;
  points: number;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

export interface QuizAttemptData {
  quizId: string;
  userId: string;
  answers: QuizAnswerData[];
}

export interface QuizAnswerData {
  questionId: string;
  answer: any;
}

export interface QuizResult {
  attemptId: string;
  score: number;
  passed: boolean;
  totalPoints: number;
  earnedPoints: number;
  timeSpent: number;
  responses: QuestionResult[];
  feedback?: string;
}

export interface QuestionResult {
  questionId: string;
  question: string;
  userAnswer: any;
  correctAnswer: any;
  isCorrect: boolean;
  pointsEarned: number;
  explanation: string;
}

export interface QuizAnalytics {
  totalAttempts: number;
  averageScore: number;
  passRate: number;
  averageTimeSpent: number;
  questionAnalytics: QuestionAnalytics[];
  difficultyAnalytics: Record<string, number>;
}

export interface QuestionAnalytics {
  questionId: string;
  question: string;
  correctAnswerRate: number;
  averagePoints: number;
  commonWrongAnswers: string[];
}

class QuizService {
  /**
   * Create a new quiz
   */
  async createQuiz(quizData: QuizCreationData, createdBy: string): Promise<{
    success: boolean;
    quizId?: string;
    error?: string;
  }> {
    try {
      // Validate module exists and user has permission
      const module = await db.module.findUnique({
        where: { id: quizData.moduleId },
        include: {
          course: {
            select: { createdBy: true }
          }
        }
      });

      if (!module) {
        return { success: false, error: 'Module not found' };
      }

      // Check if user can create quiz for this module
      const user = await db.user.findUnique({
        where: { id: createdBy },
        select: { role: true }
      });

      if (module.course.createdBy !== createdBy && user?.role !== 'ADMIN') {
        return { success: false, error: 'Insufficient permissions' };
      }

      // Check if quiz already exists for this module
      const existingQuiz = await db.quiz.findUnique({
        where: { moduleId: quizData.moduleId }
      });

      if (existingQuiz) {
        return { success: false, error: 'Quiz already exists for this module' };
      }

      // Validate quiz data
      const validation = this.validateQuizData(quizData);
      if (!validation.isValid) {
        return { success: false, error: validation.error };
      }

      // Create quiz with questions
      const quiz = await db.$transaction(async (tx) => {
        const newQuiz = await tx.quiz.create({
          data: {
            moduleId: quizData.moduleId,
            title: quizData.title,
            description: quizData.description,
            passingScore: quizData.passingScore,
            timeLimit: quizData.timeLimit,
            maxAttempts: quizData.maxAttempts,
            showResultsImmediately: quizData.showResultsImmediately,
            allowReview: quizData.allowReview,
            createdBy,
          }
        });

        // Create questions
        for (let i = 0; i < quizData.questions.length; i++) {
          const questionData = quizData.questions[i];
          await tx.question.create({
            data: {
              quizId: newQuiz.id,
              text: questionData.text,
              type: questionData.type,
              options: questionData.options || [],
              correctAnswer: questionData.correctAnswer,
              explanation: questionData.explanation,
              points: questionData.points,
              difficulty: questionData.difficulty,
              orderIndex: i + 1,
            }
          });
        }

        return newQuiz;
      });

      // Log quiz creation
      await this.logQuizActivity(createdBy, 'QUIZ_CREATED', {
        quizId: quiz.id,
        moduleId: quizData.moduleId,
        questionCount: quizData.questions.length,
      });

      return { success: true, quizId: quiz.id };

    } catch (error) {
      console.error('Quiz creation failed:', error);
      return { success: false, error: 'Quiz creation failed' };
    }
  }

  /**
   * Start a quiz attempt
   */
  async startQuizAttempt(quizId: string, userId: string): Promise<{
    success: boolean;
    attemptId?: string;
    quiz?: any;
    error?: string;
  }> {
    try {
      // Get quiz with questions
      const quiz = await db.quiz.findUnique({
        where: { id: quizId },
        include: {
          questions: {
            orderBy: { orderIndex: 'asc' },
            select: {
              id: true,
              text: true,
              type: true,
              options: true,
              points: true,
              orderIndex: true,
              // Don't include correctAnswer or explanation
            }
          },
          module: {
            include: {
              course: {
                include: {
                  enrollments: {
                    where: { userId }
                  }
                }
              }
            }
          }
        }
      });

      if (!quiz) {
        return { success: false, error: 'Quiz not found' };
      }

      // Check if user is enrolled in the course
      if (quiz.module.course.enrollments.length === 0) {
        return { success: false, error: 'Not enrolled in course' };
      }

      // Check previous attempts
      const attemptCount = await db.quizAttempt.count({
        where: {
          quizId,
          userId,
          submittedAt: { not: null }
        }
      });

      if (attemptCount >= quiz.maxAttempts) {
        return { success: false, error: 'Maximum attempts exceeded' };
      }

      // Check for ongoing attempt
      const ongoingAttempt = await db.quizAttempt.findFirst({
        where: {
          quizId,
          userId,
          submittedAt: null
        }
      });

      if (ongoingAttempt) {
        // Return existing attempt
        return {
          success: true,
          attemptId: ongoingAttempt.id,
          quiz: {
            ...quiz,
            questions: quiz.questions,
            timeLimit: quiz.timeLimit,
            passingScore: quiz.passingScore,
          }
        };
      }

      // Create new attempt
      const attempt = await db.quizAttempt.create({
        data: {
          quizId,
          userId,
          startedAt: new Date(),
        }
      });

      // Log quiz start
      await this.logQuizActivity(userId, 'QUIZ_STARTED', {
        quizId,
        attemptId: attempt.id,
        attemptNumber: attemptCount + 1,
      });

      return {
        success: true,
        attemptId: attempt.id,
        quiz: {
          ...quiz,
          questions: quiz.questions,
          timeLimit: quiz.timeLimit,
          passingScore: quiz.passingScore,
        }
      };

    } catch (error) {
      console.error('Quiz attempt start failed:', error);
      return { success: false, error: 'Failed to start quiz' };
    }
  }

  /**
   * Submit quiz attempt
   */
  async submitQuizAttempt(attemptData: QuizAttemptData): Promise<{
    success: boolean;
    result?: QuizResult;
    error?: string;
  }> {
    try {
      // Get attempt and quiz
      const attempt = await db.quizAttempt.findUnique({
        where: { id: attemptData.quizId }, // This should be attemptId
        include: {
          quiz: {
            include: {
              questions: {
                orderBy: { orderIndex: 'asc' }
              }
            }
          }
        }
      });

      if (!attempt || attempt.submittedAt) {
        return { success: false, error: 'Invalid or already submitted attempt' };
      }

      if (attempt.userId !== attemptData.userId) {
        return { success: false, error: 'Unauthorized access' };
      }

      // Check time limit
      const quiz = attempt.quiz;
      if (quiz.timeLimit) {
        const elapsedTime = Date.now() - attempt.startedAt.getTime();
        if (elapsedTime > quiz.timeLimit * 60 * 1000) {
          return { success: false, error: 'Time limit exceeded' };
        }
      }

      // Grade the quiz
      const gradingResult = await this.gradeQuiz(quiz, attemptData.answers);

      // Save responses and update attempt
      const submittedAt = new Date();
      const timeSpent = Math.round((submittedAt.getTime() - attempt.startedAt.getTime()) / 1000);

      await db.$transaction(async (tx) => {
        // Save question responses
        for (const response of gradingResult.responses) {
          await tx.questionResponse.create({
            data: {
              attemptId: attempt.id,
              questionId: response.questionId,
              answer: response.userAnswer,
              isCorrect: response.isCorrect,
              pointsEarned: response.pointsEarned,
            }
          });
        }

        // Update attempt
        await tx.quizAttempt.update({
          where: { id: attempt.id },
          data: {
            score: gradingResult.score,
            passed: gradingResult.passed,
            timeSpent,
            submittedAt,
          }
        });
      });

      // Update course progress if quiz passed
      if (gradingResult.passed) {
        await this.updateCourseProgress(attemptData.userId, quiz.moduleId);
      }

      // Log quiz completion
      await this.logQuizActivity(attemptData.userId, 'QUIZ_COMPLETED', {
        quizId: quiz.id,
        attemptId: attempt.id,
        score: gradingResult.score,
        passed: gradingResult.passed,
        timeSpent,
      });

      const result: QuizResult = {
        attemptId: attempt.id,
        score: gradingResult.score,
        passed: gradingResult.passed,
        totalPoints: gradingResult.totalPoints,
        earnedPoints: gradingResult.earnedPoints,
        timeSpent,
        responses: gradingResult.responses,
        feedback: this.generateFeedback(gradingResult),
      };

      return { success: true, result };

    } catch (error) {
      console.error('Quiz submission failed:', error);
      return { success: false, error: 'Quiz submission failed' };
    }
  }

  /**
   * Get quiz results
   */
  async getQuizResult(attemptId: string, userId: string): Promise<{
    success: boolean;
    result?: QuizResult;
    error?: string;
  }> {
    try {
      const attempt = await db.quizAttempt.findUnique({
        where: { id: attemptId },
        include: {
          quiz: {
            include: {
              questions: {
                orderBy: { orderIndex: 'asc' }
              }
            }
          },
          responses: {
            include: {
              question: true
            }
          }
        }
      });

      if (!attempt || attempt.userId !== userId) {
        return { success: false, error: 'Attempt not found' };
      }

      if (!attempt.submittedAt) {
        return { success: false, error: 'Attempt not submitted yet' };
      }

      // Check if results should be shown immediately
      if (!attempt.quiz.showResultsImmediately) {
        return { success: false, error: 'Results not available yet' };
      }

      const responses: QuestionResult[] = attempt.responses.map(response => ({
        questionId: response.questionId,
        question: response.question.text,
        userAnswer: response.answer,
        correctAnswer: response.question.correctAnswer,
        isCorrect: response.isCorrect,
        pointsEarned: response.pointsEarned,
        explanation: response.question.explanation,
      }));

      const totalPoints = attempt.quiz.questions.reduce((sum, q) => sum + q.points, 0);
      const earnedPoints = attempt.responses.reduce((sum, r) => sum + r.pointsEarned, 0);

      const result: QuizResult = {
        attemptId: attempt.id,
        score: attempt.score || 0,
        passed: attempt.passed,
        totalPoints,
        earnedPoints,
        timeSpent: attempt.timeSpent || 0,
        responses,
        feedback: this.generateResultFeedback(attempt.score || 0, attempt.passed, attempt.quiz.passingScore),
      };

      return { success: true, result };

    } catch (error) {
      console.error('Get quiz result failed:', error);
      return { success: false, error: 'Failed to get quiz result' };
    }
  }

  /**
   * Get quiz analytics
   */
  async getQuizAnalytics(quizId: string): Promise<{
    success: boolean;
    analytics?: QuizAnalytics;
    error?: string;
  }> {
    try {
      const quiz = await db.quiz.findUnique({
        where: { id: quizId },
        include: {
          questions: true,
          attempts: {
            where: { submittedAt: { not: null } },
            include: {
              responses: {
                include: {
                  question: true
                }
              }
            }
          }
        }
      });

      if (!quiz) {
        return { success: false, error: 'Quiz not found' };
      }

      const completedAttempts = quiz.attempts;
      
      if (completedAttempts.length === 0) {
        return {
          success: true,
          analytics: {
            totalAttempts: 0,
            averageScore: 0,
            passRate: 0,
            averageTimeSpent: 0,
            questionAnalytics: [],
            difficultyAnalytics: {},
          }
        };
      }

      // Calculate basic metrics
      const totalAttempts = completedAttempts.length;
      const averageScore = completedAttempts.reduce((sum, a) => sum + (a.score || 0), 0) / totalAttempts;
      const passedAttempts = completedAttempts.filter(a => a.passed).length;
      const passRate = (passedAttempts / totalAttempts) * 100;
      const averageTimeSpent = completedAttempts.reduce((sum, a) => sum + (a.timeSpent || 0), 0) / totalAttempts;

      // Question analytics
      const questionAnalytics: QuestionAnalytics[] = quiz.questions.map(question => {
        const responses = completedAttempts.flatMap(a => 
          a.responses.filter(r => r.questionId === question.id)
        );

        const correctResponses = responses.filter(r => r.isCorrect).length;
        const correctAnswerRate = responses.length > 0 ? (correctResponses / responses.length) * 100 : 0;
        const averagePoints = responses.length > 0 
          ? responses.reduce((sum, r) => sum + r.pointsEarned, 0) / responses.length 
          : 0;

        // Find common wrong answers
        const wrongAnswers = responses.filter(r => !r.isCorrect).map(r => JSON.stringify(r.answer));
        const answerCounts = wrongAnswers.reduce((acc, answer) => {
          acc[answer] = (acc[answer] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        const commonWrongAnswers = Object.entries(answerCounts)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3)
          .map(([answer]) => JSON.parse(answer));

        return {
          questionId: question.id,
          question: question.text,
          correctAnswerRate,
          averagePoints,
          commonWrongAnswers,
        };
      });

      // Difficulty analytics
      const difficultyAnalytics = quiz.questions.reduce((acc, question) => {
        const responses = completedAttempts.flatMap(a => 
          a.responses.filter(r => r.questionId === question.id)
        );
        const correctResponses = responses.filter(r => r.isCorrect).length;
        const rate = responses.length > 0 ? (correctResponses / responses.length) * 100 : 0;
        
        acc[question.difficulty] = (acc[question.difficulty] || 0) + rate;
        return acc;
      }, {} as Record<string, number>);

      // Average the difficulty rates
      Object.keys(difficultyAnalytics).forEach(key => {
        const questionCount = quiz.questions.filter(q => q.difficulty === key).length;
        difficultyAnalytics[key] = difficultyAnalytics[key] / questionCount;
      });

      const analytics: QuizAnalytics = {
        totalAttempts,
        averageScore: Math.round(averageScore * 100) / 100,
        passRate: Math.round(passRate * 100) / 100,
        averageTimeSpent: Math.round(averageTimeSpent),
        questionAnalytics,
        difficultyAnalytics,
      };

      return { success: true, analytics };

    } catch (error) {
      console.error('Get quiz analytics failed:', error);
      return { success: false, error: 'Failed to get analytics' };
    }
  }

  /**
   * Auto-grade quiz
   */
  private async gradeQuiz(quiz: any, answers: QuizAnswerData[]): Promise<{
    score: number;
    passed: boolean;
    totalPoints: number;
    earnedPoints: number;
    responses: QuestionResult[];
  }> {
    const responses: QuestionResult[] = [];
    let totalPoints = 0;
    let earnedPoints = 0;

    for (const question of quiz.questions) {
      totalPoints += question.points;
      
      const userAnswer = answers.find(a => a.questionId === question.id);
      const isCorrect = this.checkAnswer(question, userAnswer?.answer);
      const pointsEarned = isCorrect ? question.points : 0;
      earnedPoints += pointsEarned;

      responses.push({
        questionId: question.id,
        question: question.text,
        userAnswer: userAnswer?.answer || null,
        correctAnswer: question.correctAnswer,
        isCorrect,
        pointsEarned,
        explanation: question.explanation,
      });
    }

    const score = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
    const passed = score >= quiz.passingScore;

    return {
      score,
      passed,
      totalPoints,
      earnedPoints,
      responses,
    };
  }

  /**
   * Check if an answer is correct
   */
  private checkAnswer(question: any, userAnswer: any): boolean {
    if (!userAnswer) return false;

    switch (question.type) {
      case 'MULTIPLE_CHOICE':
        return userAnswer === question.correctAnswer;
      
      case 'TRUE_FALSE':
        return userAnswer === question.correctAnswer;
      
      case 'FILL_BLANK':
        const correctAnswers = Array.isArray(question.correctAnswer) 
          ? question.correctAnswer 
          : [question.correctAnswer];
        return correctAnswers.some((correct: string) => 
          userAnswer.toString().toLowerCase().trim() === correct.toString().toLowerCase().trim()
        );
      
      case 'ESSAY':
        // Essay questions require manual grading
        return false;
      
      default:
        return false;
    }
  }

  /**
   * Validate quiz creation data
   */
  private validateQuizData(quizData: QuizCreationData): { isValid: boolean; error?: string } {
    if (!quizData.title.trim()) {
      return { isValid: false, error: 'Quiz title is required' };
    }

    if (!quizData.description.trim()) {
      return { isValid: false, error: 'Quiz description is required' };
    }

    if (quizData.passingScore < 0 || quizData.passingScore > 100) {
      return { isValid: false, error: 'Passing score must be between 0 and 100' };
    }

    if (quizData.maxAttempts < 1) {
      return { isValid: false, error: 'Max attempts must be at least 1' };
    }

    if (quizData.questions.length === 0) {
      return { isValid: false, error: 'Quiz must have at least one question' };
    }

    // Validate questions
    for (let i = 0; i < quizData.questions.length; i++) {
      const question = quizData.questions[i];
      
      if (!question.text.trim()) {
        return { isValid: false, error: `Question ${i + 1}: Text is required` };
      }

      if (question.points <= 0) {
        return { isValid: false, error: `Question ${i + 1}: Points must be positive` };
      }

      if (question.type === 'MULTIPLE_CHOICE' && (!question.options || question.options.length < 2)) {
        return { isValid: false, error: `Question ${i + 1}: Multiple choice questions need at least 2 options` };
      }
    }

    return { isValid: true };
  }

  /**
   * Generate feedback based on quiz performance
   */
  private generateFeedback(gradingResult: any): string {
    const { score, passed, responses } = gradingResult;
    
    let feedback = '';
    
    if (passed) {
      if (score >= 95) {
        feedback = 'Excellent work! You have demonstrated mastery of this material.';
      } else if (score >= 85) {
        feedback = 'Great job! You have a strong understanding of the material.';
      } else {
        feedback = 'Good work! You have passed the quiz.';
      }
    } else {
      feedback = 'You did not pass this time. Review the material and try again.';
    }

    // Add specific recommendations
    const incorrectResponses = responses.filter((r: any) => !r.isCorrect);
    if (incorrectResponses.length > 0) {
      feedback += ' Focus on reviewing the topics covered in the questions you missed.';
    }

    return feedback;
  }

  /**
   * Generate result feedback
   */
  private generateResultFeedback(score: number, passed: boolean, passingScore: number): string {
    if (passed) {
      return `Congratulations! You scored ${score.toFixed(1)}% and passed the quiz (passing score: ${passingScore}%).`;
    } else {
      return `You scored ${score.toFixed(1)}%. You need ${passingScore}% to pass. Keep studying and try again!`;
    }
  }

  /**
   * Update course progress when quiz is passed
   */
  private async updateCourseProgress(userId: string, moduleId: string): Promise<void> {
    try {
      const module = await db.module.findUnique({
        where: { id: moduleId },
        select: { courseId: true }
      });

      if (module) {
        // This would integrate with the progress tracking system
        // For now, we'll just log the completion
        await this.logQuizActivity(userId, 'MODULE_QUIZ_COMPLETED', {
          moduleId,
          courseId: module.courseId,
        });
      }
    } catch (error) {
      console.error('Failed to update course progress:', error);
    }
  }

  /**
   * Log quiz activity
   */
  private async logQuizActivity(userId: string, action: string, details: Record<string, any>): Promise<void> {
    try {
      await db.activityLog.create({
        data: {
          userId,
          action,
          resource: 'quiz',
          details,
          ipAddress: 'unknown',
          userAgent: 'unknown',
        }
      });
    } catch (error) {
      console.error('Failed to log quiz activity:', error);
    }
  }
}

export const quizService = new QuizService();