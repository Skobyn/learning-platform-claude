/**
 * Quiz Page Object Model
 * Encapsulates interactions with quiz pages
 */

import { Page, Locator, expect } from '@playwright/test';

export class QuizPage {
  readonly page: Page;
  readonly quizTitle: Locator;
  readonly quizInstructions: Locator;
  readonly startQuizButton: Locator;
  readonly questionContainer: Locator;
  readonly questionText: Locator;
  readonly questionOptions: Locator;
  readonly nextQuestionButton: Locator;
  readonly prevQuestionButton: Locator;
  readonly submitQuizButton: Locator;
  readonly confirmSubmitButton: Locator;
  readonly quizResults: Locator;
  readonly scoreDisplay: Locator;
  readonly passingStatus: Locator;
  readonly retakeButton: Locator;
  readonly reviewAnswersButton: Locator;
  readonly timer: Locator;
  readonly progressIndicator: Locator;

  constructor(page: Page) {
    this.page = page;
    this.quizTitle = page.locator('[data-testid=quiz-title]');
    this.quizInstructions = page.locator('[data-testid=quiz-instructions]');
    this.startQuizButton = page.locator('[data-testid=start-quiz]');
    this.questionContainer = page.locator('[data-testid=quiz-question]');
    this.questionText = page.locator('[data-testid=question-text]');
    this.questionOptions = page.locator('[data-testid^=option-]');
    this.nextQuestionButton = page.locator('[data-testid=next-question]');
    this.prevQuestionButton = page.locator('[data-testid=prev-question]');
    this.submitQuizButton = page.locator('[data-testid=submit-quiz]');
    this.confirmSubmitButton = page.locator('[data-testid=confirm-submit]');
    this.quizResults = page.locator('[data-testid=quiz-results]');
    this.scoreDisplay = page.locator('[data-testid=quiz-score]');
    this.passingStatus = page.locator('[data-testid=passing-status]');
    this.retakeButton = page.locator('[data-testid=retake-button]');
    this.reviewAnswersButton = page.locator('[data-testid=review-answers]');
    this.timer = page.locator('[data-testid=quiz-timer]');
    this.progressIndicator = page.locator('[data-testid=quiz-progress]');
  }

  async startQuiz() {
    await expect(this.quizInstructions).toBeVisible();
    await this.startQuizButton.click();
    await expect(this.questionContainer).toBeVisible();
  }

  async answerMultipleChoice(optionIndex: number) {
    const option = this.page.locator(`[data-testid=option-${optionIndex}]`);
    await option.click();
    await expect(option).toBeChecked();
  }

  async answerTrueFalse(answer: boolean) {
    const option = this.page.locator(`[data-testid=option-${answer ? 'true' : 'false'}]`);
    await option.click();
  }

  async answerShortAnswer(text: string) {
    const textInput = this.page.locator('[data-testid=short-answer-input]');
    await textInput.fill(text);
  }

  async answerEssay(text: string) {
    const essayInput = this.page.locator('[data-testid=essay-input]');
    await essayInput.fill(text);
  }

  async nextQuestion() {
    await this.nextQuestionButton.click();
  }

  async previousQuestion() {
    await this.prevQuestionButton.click();
  }

  async submitQuiz() {
    await this.submitQuizButton.click();
    await this.confirmSubmitButton.click();
    await expect(this.quizResults).toBeVisible();
  }

  async takeQuiz() {
    await this.startQuiz();
    
    const questions = await this.page.locator('[data-testid=quiz-question]').count();
    
    for (let i = 0; i < questions; i++) {
      // Get question type
      const questionType = await this.getQuestionType();
      
      // Answer based on type
      switch (questionType) {
        case 'multiple_choice':
          await this.answerMultipleChoice(0); // Select first option
          break;
        case 'true_false':
          await this.answerTrueFalse(true);
          break;
        case 'short_answer':
          await this.answerShortAnswer('Test answer');
          break;
        case 'essay':
          await this.answerEssay('This is a test essay answer with sufficient content.');
          break;
      }
      
      // Move to next question if not the last one
      if (i < questions - 1) {
        await this.nextQuestion();
      }
    }
    
    await this.submitQuiz();
  }

  async passQuiz() {
    await this.startQuiz();
    
    const questions = await this.page.locator('[data-testid=quiz-question]').count();
    
    for (let i = 0; i < questions; i++) {
      // Answer correctly (assuming first option is correct for simplicity)
      const correctAnswer = await this.page.locator('[data-testid=correct-answer]').getAttribute('data-value');
      
      if (correctAnswer) {
        await this.answerMultipleChoice(parseInt(correctAnswer));
      } else {
        // Fallback to first option
        await this.answerMultipleChoice(0);
      }
      
      if (i < questions - 1) {
        await this.nextQuestion();
      }
    }
    
    await this.submitQuiz();
    await expect(this.passingStatus).toContainText('Passed');
  }

  async failQuiz() {
    await this.startQuiz();
    
    const questions = await this.page.locator('[data-testid=quiz-question]').count();
    
    for (let i = 0; i < questions; i++) {
      // Answer incorrectly (select last option)
      const options = await this.page.locator('[data-testid^=option-]').count();
      await this.answerMultipleChoice(options - 1);
      
      if (i < questions - 1) {
        await this.nextQuestion();
      }
    }
    
    await this.submitQuiz();
    await expect(this.passingStatus).toContainText('Failed');
  }

  async retakeQuiz() {
    await this.retakeButton.click();
    await expect(this.quizInstructions).toBeVisible();
    await expect(this.page.locator('[data-testid=attempt-number]')).toBeVisible();
  }

  async reviewAnswers() {
    await this.reviewAnswersButton.click();
    await expect(this.page.locator('[data-testid=answer-review]')).toBeVisible();
  }

  async getScore(): Promise<number> {
    const scoreText = await this.scoreDisplay.textContent();
    const match = scoreText?.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  async getTimeRemaining(): Promise<string> {
    const timerText = await this.timer.textContent();
    return timerText || '00:00';
  }

  async getCurrentQuestionNumber(): Promise<number> {
    const progressText = await this.progressIndicator.textContent();
    const match = progressText?.match(/(\d+) of \d+/);
    return match ? parseInt(match[1]) : 1;
  }

  async getTotalQuestions(): Promise<number> {
    const progressText = await this.progressIndicator.textContent();
    const match = progressText?.match(/\d+ of (\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  async getQuestionType(): Promise<string> {
    if (await this.page.locator('[data-testid^=option-]').first().isVisible()) {
      return 'multiple_choice';
    } else if (await this.page.locator('[data-testid=short-answer-input]').isVisible()) {
      return 'short_answer';
    } else if (await this.page.locator('[data-testid=essay-input]').isVisible()) {
      return 'essay';
    } else if (await this.page.locator('[data-testid=option-true]').isVisible()) {
      return 'true_false';
    }
    return 'unknown';
  }

  async isQuestionAnswered(): Promise<boolean> {
    const selectedOption = this.page.locator('[data-testid^=option-]:checked');
    const textInput = this.page.locator('[data-testid=short-answer-input]');
    const essayInput = this.page.locator('[data-testid=essay-input]');
    
    if (await selectedOption.count() > 0) return true;
    if (await textInput.isVisible() && await textInput.inputValue() !== '') return true;
    if (await essayInput.isVisible() && await essayInput.inputValue() !== '') return true;
    
    return false;
  }

  async expectQuizInterface() {
    await expect(this.quizTitle).toBeVisible();
    await expect(this.questionContainer).toBeVisible();
    await expect(this.progressIndicator).toBeVisible();
  }

  async expectResults() {
    await expect(this.quizResults).toBeVisible();
    await expect(this.scoreDisplay).toBeVisible();
    await expect(this.passingStatus).toBeVisible();
  }
}