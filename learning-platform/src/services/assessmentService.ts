import { PrismaClient } from '@prisma/client';
import { Quiz, Question, QuestionType, QuizAttempt, QuizAnswer } from '../types';
import { NotFoundError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import OpenAI from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export class AssessmentService {
  /**
   * Create a new quiz for a module
   */
  async createQuiz(moduleId: string, quizData: Omit<Quiz, 'id' | 'moduleId' | 'createdAt' | 'updatedAt' | 'questions'>): Promise<Quiz> {
    try {
      logger.info('Creating new quiz', { moduleId, title: quizData.title });
      
      const quiz = await prisma.quiz.create({
        data: {
          ...quizData,
          moduleId
        },
        include: {
          questions: true
        }
      });

      logger.info('Quiz created successfully', { quizId: quiz.id });
      return quiz as Quiz;
    } catch (error) {
      logger.error('Error creating quiz', { moduleId, error });
      throw new ValidationError('Failed to create quiz');
    }
  }

  /**
   * Add question to quiz
   */
  async addQuestion(quizId: string, questionData: Omit<Question, 'id' | 'quizId'>): Promise<Question> {
    try {
      logger.info('Adding question to quiz', { quizId, type: questionData.type });
      
      const question = await prisma.question.create({
        data: {
          ...questionData,
          quizId,
          type: questionData.type as any,
          correctAnswer: Array.isArray(questionData.correctAnswer) ? 
            questionData.correctAnswer : 
            [questionData.correctAnswer]
        }
      });

      logger.info('Question added successfully', { questionId: question.id });
      return question as Question;
    } catch (error) {
      logger.error('Error adding question', { quizId, error });
      throw new ValidationError('Failed to add question');
    }
  }

  /**
   * Get quiz by ID with questions
   */
  async getQuizById(quizId: string): Promise<Quiz> {
    try {
      const quiz = await prisma.quiz.findUnique({
        where: { id: quizId },
        include: {
          questions: {
            orderBy: { order: 'asc' }
          }
        }
      });

      if (!quiz) {
        throw new NotFoundError('Quiz not found');
      }

      return quiz as Quiz;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Error fetching quiz', { quizId, error });
      throw new ValidationError('Failed to fetch quiz');
    }
  }

  /**
   * Start a new quiz attempt
   */
  async startQuizAttempt(quizId: string, userId: string): Promise<QuizAttempt> {
    try {
      logger.info('Starting quiz attempt', { quizId, userId });
      
      // Check if user has already attempted this quiz
      const existingAttempt = await prisma.quizAttempt.findFirst({
        where: {
          quizId,
          userId,
          completedAt: null
        }
      });

      if (existingAttempt) {
        logger.info('Resuming existing quiz attempt', { attemptId: existingAttempt.id });
        return existingAttempt as QuizAttempt;
      }

      const attempt = await prisma.quizAttempt.create({
        data: {
          quizId,
          userId,
          answers: [],
          score: 0,
          passed: false,
          startedAt: new Date()
        },
        include: {
          quiz: {
            include: {
              questions: true
            }
          }
        }
      });

      logger.info('Quiz attempt started', { attemptId: attempt.id });
      return attempt as QuizAttempt;
    } catch (error) {
      logger.error('Error starting quiz attempt', { quizId, userId, error });
      throw new ValidationError('Failed to start quiz attempt');
    }
  }

  /**
   * Submit answer for a question
   */
  async submitAnswer(attemptId: string, questionId: string, answer: string | string[]): Promise<QuizAnswer> {
    try {
      logger.info('Submitting quiz answer', { attemptId, questionId });
      
      const attempt = await prisma.quizAttempt.findUnique({
        where: { id: attemptId },
        include: {
          quiz: {
            include: {
              questions: true
            }
          }
        }
      });

      if (!attempt) {
        throw new NotFoundError('Quiz attempt not found');
      }

      if (attempt.completedAt) {
        throw new ValidationError('Quiz attempt already completed');
      }

      const question = attempt.quiz.questions.find(q => q.id === questionId);
      if (!question) {
        throw new NotFoundError('Question not found in this quiz');
      }

      // Evaluate answer
      const isCorrect = this.evaluateAnswer(question, answer);
      const pointsEarned = isCorrect ? question.points : 0;

      const quizAnswer: QuizAnswer = {
        questionId,
        answer,
        isCorrect,
        pointsEarned
      };

      // Update attempt with new answer
      const updatedAnswers = [...(attempt.answers as QuizAnswer[])];
      const existingIndex = updatedAnswers.findIndex(a => a.questionId === questionId);
      
      if (existingIndex >= 0) {
        updatedAnswers[existingIndex] = quizAnswer;
      } else {
        updatedAnswers.push(quizAnswer);
      }

      await prisma.quizAttempt.update({
        where: { id: attemptId },
        data: { answers: updatedAnswers }
      });

      logger.info('Answer submitted successfully', { attemptId, questionId, isCorrect });
      return quizAnswer;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
      logger.error('Error submitting answer', { attemptId, questionId, error });
      throw new ValidationError('Failed to submit answer');
    }
  }

  /**
   * Complete quiz attempt and calculate final score
   */
  async completeQuizAttempt(attemptId: string): Promise<QuizAttempt> {
    try {
      logger.info('Completing quiz attempt', { attemptId });
      
      const attempt = await prisma.quizAttempt.findUnique({
        where: { id: attemptId },
        include: {
          quiz: {
            include: {
              questions: true
            }
          }
        }
      });

      if (!attempt) {
        throw new NotFoundError('Quiz attempt not found');
      }

      if (attempt.completedAt) {
        throw new ValidationError('Quiz attempt already completed');
      }

      const answers = attempt.answers as QuizAnswer[];
      const totalPoints = attempt.quiz.questions.reduce((sum, q) => sum + q.points, 0);
      const earnedPoints = answers.reduce((sum, a) => sum + a.pointsEarned, 0);
      
      const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
      const passed = score >= attempt.quiz.passingScore;

      const completedAttempt = await prisma.quizAttempt.update({
        where: { id: attemptId },
        data: {
          score,
          passed,
          completedAt: new Date(),
          submittedAt: new Date()
        },
        include: {
          quiz: {
            include: {
              questions: true
            }
          }
        }
      });

      logger.info('Quiz attempt completed', { attemptId, score, passed });
      return completedAttempt as QuizAttempt;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
      logger.error('Error completing quiz attempt', { attemptId, error });
      throw new ValidationError('Failed to complete quiz attempt');
    }
  }

  /**
   * Get user's quiz attempts
   */
  async getUserQuizAttempts(userId: string, quizId?: string): Promise<QuizAttempt[]> {
    try {
      const attempts = await prisma.quizAttempt.findMany({
        where: {
          userId,
          ...(quizId && { quizId })
        },
        include: {
          quiz: {
            include: {
              questions: true
            }
          }
        },
        orderBy: { startedAt: 'desc' }
      });

      return attempts as QuizAttempt[];
    } catch (error) {
      logger.error('Error fetching user quiz attempts', { userId, quizId, error });
      throw new ValidationError('Failed to fetch quiz attempts');
    }
  }

  /**
   * AI-powered question generation
   */
  async generateQuestions(
    topic: string, 
    difficulty: string, 
    questionCount: number = 5,
    types: QuestionType[] = [QuestionType.MULTIPLE_CHOICE, QuestionType.TRUE_FALSE]
  ): Promise<Omit<Question, 'id' | 'quizId'>[]> {
    try {
      logger.info('Generating AI questions', { topic, difficulty, questionCount });
      
      const prompt = `
        Generate ${questionCount} quiz questions about "${topic}" at ${difficulty} difficulty level.
        
        Include these question types: ${types.join(', ')}
        
        For each question, provide:
        1. Question text
        2. Question type
        3. Answer options (for multiple choice)
        4. Correct answer(s)
        5. Brief explanation
        6. Points (1-5 based on difficulty)
        
        Ensure questions are:
        - Educationally valuable
        - Clear and unambiguous
        - Appropriate for the difficulty level
        - Varied in complexity
        
        Respond in JSON format as an array of questions.
      `;

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        response_format: { type: "json_object" }
      });

      const response = JSON.parse(completion.choices[0].message.content || '{"questions": []}');
      const questions = response.questions || [];
      
      // Format questions to match our schema
      const formattedQuestions = questions.map((q: any, index: number) => ({
        type: q.type || QuestionType.MULTIPLE_CHOICE,
        question: q.question,
        options: q.options || [],
        correctAnswer: Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer],
        explanation: q.explanation,
        points: q.points || 1,
        order: index + 1
      }));

      logger.info('Questions generated successfully', { topic, count: formattedQuestions.length });
      return formattedQuestions;
    } catch (error) {
      logger.error('Error generating questions', { topic, error });
      throw new ValidationError('Failed to generate questions');
    }
  }

  /**
   * Get quiz analytics
   */
  async getQuizAnalytics(quizId: string): Promise<{
    totalAttempts: number;
    averageScore: number;
    passRate: number;
    questionAnalytics: Array<{
      questionId: string;
      correctRate: number;
      averageTime: number;
    }>;
  }> {
    try {
      const attempts = await prisma.quizAttempt.findMany({
        where: { 
          quizId,
          completedAt: { not: null }
        }
      });

      const totalAttempts = attempts.length;
      const averageScore = totalAttempts > 0 ? 
        attempts.reduce((sum, a) => sum + a.score, 0) / totalAttempts : 0;
      const passedAttempts = attempts.filter(a => a.passed).length;
      const passRate = totalAttempts > 0 ? (passedAttempts / totalAttempts) * 100 : 0;

      // Analyze individual questions
      const quiz = await this.getQuizById(quizId);
      const questionAnalytics = quiz.questions.map(question => {
        const questionAnswers = attempts.flatMap(attempt => 
          (attempt.answers as QuizAnswer[]).filter(answer => answer.questionId === question.id)
        );
        
        const correctAnswers = questionAnswers.filter(answer => answer.isCorrect).length;
        const correctRate = questionAnswers.length > 0 ? 
          (correctAnswers / questionAnswers.length) * 100 : 0;

        return {
          questionId: question.id,
          correctRate,
          averageTime: 0 // Would need additional tracking for timing
        };
      });

      return {
        totalAttempts,
        averageScore,
        passRate,
        questionAnalytics
      };
    } catch (error) {
      logger.error('Error fetching quiz analytics', { quizId, error });
      throw new ValidationError('Failed to fetch quiz analytics');
    }
  }

  /**
   * Evaluate answer correctness
   */
  private evaluateAnswer(question: Question, userAnswer: string | string[]): boolean {
    const correctAnswers = Array.isArray(question.correctAnswer) ? 
      question.correctAnswer : [question.correctAnswer];
    
    if (Array.isArray(userAnswer)) {
      // For multiple selection questions
      return userAnswer.length === correctAnswers.length &&
        userAnswer.every(answer => correctAnswers.includes(answer));
    } else {
      // For single answer questions
      if (question.type === QuestionType.TRUE_FALSE) {
        return userAnswer.toLowerCase() === correctAnswers[0].toLowerCase();
      }
      return correctAnswers.includes(userAnswer);
    }
  }

  /**
   * Update quiz details
   */
  async updateQuiz(quizId: string, updates: Partial<Quiz>): Promise<Quiz> {
    try {
      logger.info('Updating quiz', { quizId });
      
      const quiz = await prisma.quiz.update({
        where: { id: quizId },
        data: {
          ...updates,
          updatedAt: new Date()
        },
        include: {
          questions: true
        }
      });

      logger.info('Quiz updated successfully', { quizId });
      return quiz as Quiz;
    } catch (error) {
      logger.error('Error updating quiz', { quizId, error });
      throw new ValidationError('Failed to update quiz');
    }
  }

  /**
   * Delete quiz
   */
  async deleteQuiz(quizId: string): Promise<void> {
    try {
      logger.info('Deleting quiz', { quizId });
      
      await prisma.quiz.delete({
        where: { id: quizId }
      });

      logger.info('Quiz deleted successfully', { quizId });
    } catch (error) {
      logger.error('Error deleting quiz', { quizId, error });
      throw new ValidationError('Failed to delete quiz');
    }
  }
}

export const assessmentService = new AssessmentService();