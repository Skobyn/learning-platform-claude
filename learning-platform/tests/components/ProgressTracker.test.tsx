import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../utils/test-helpers';
import { ProgressTracker } from '../../src/components/progress/ProgressTracker';

describe('ProgressTracker', () => {
  const mockProgressData = {
    courseId: '1',
    totalLessons: 10,
    completedLessons: 6,
    completionPercentage: 60,
    totalTimeSpent: 7200, // 2 hours
    lastAccessed: new Date('2023-10-15T14:30:00Z').toISOString(),
    averageScore: 85,
    lessons: [
      {
        id: '1',
        title: 'Introduction',
        completed: true,
        timeSpent: 900,
        score: 95,
        completedAt: new Date('2023-10-10T10:00:00Z').toISOString()
      },
      {
        id: '2',
        title: 'Getting Started',
        completed: true,
        timeSpent: 1200,
        score: 88,
        completedAt: new Date('2023-10-11T11:00:00Z').toISOString()
      },
      {
        id: '3',
        title: 'Advanced Concepts',
        completed: false,
        timeSpent: 300,
        score: null,
        completedAt: null
      }
    ]
  };

  const defaultProps = {
    courseId: '1',
    userId: '1',
    progressData: mockProgressData,
    onLessonSelect: jest.fn(),
    onResetProgress: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render progress overview correctly', () => {
    renderWithProviders(<ProgressTracker {...defaultProps} />);

    expect(screen.getByText('Course Progress')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument(); // Completion percentage
    expect(screen.getByText('6 of 10 lessons completed')).toBeInTheDocument();
    expect(screen.getByText('2h 0m')).toBeInTheDocument(); // Total time spent
    expect(screen.getByText('85%')).toBeInTheDocument(); // Average score
  });

  it('should display progress bar with correct percentage', () => {
    renderWithProviders(<ProgressTracker {...defaultProps} />);

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute('aria-valuenow', '60');
    expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    expect(progressBar).toHaveAttribute('aria-valuemax', '100');

    const progressFill = screen.getByTestId('progress-fill');
    expect(progressFill).toHaveStyle('width: 60%');
  });

  it('should render lesson list with completion status', () => {
    renderWithProviders(<ProgressTracker {...defaultProps} />);

    // Completed lessons
    const completedLesson1 = screen.getByText('Introduction');
    const completedLesson2 = screen.getByText('Getting Started');
    expect(completedLesson1).toBeInTheDocument();
    expect(completedLesson2).toBeInTheDocument();

    // Check completion icons
    expect(screen.getAllByTestId('check-icon')).toHaveLength(2);

    // Incomplete lesson
    const incompleteLesson = screen.getByText('Advanced Concepts');
    expect(incompleteLesson).toBeInTheDocument();
    expect(screen.getByTestId('clock-icon')).toBeInTheDocument();
  });

  it('should display lesson scores for completed lessons', () => {
    renderWithProviders(<ProgressTracker {...defaultProps} />);

    expect(screen.getByText('95%')).toBeInTheDocument(); // Score for lesson 1
    expect(screen.getByText('88%')).toBeInTheDocument(); // Score for lesson 2
  });

  it('should display lesson time spent', () => {
    renderWithProviders(<ProgressTracker {...defaultProps} />);

    expect(screen.getByText('15m')).toBeInTheDocument(); // 900 seconds = 15 minutes
    expect(screen.getByText('20m')).toBeInTheDocument(); // 1200 seconds = 20 minutes
    expect(screen.getByText('5m')).toBeInTheDocument(); // 300 seconds = 5 minutes
  });

  it('should handle lesson selection', () => {
    renderWithProviders(<ProgressTracker {...defaultProps} />);

    const lesson = screen.getByText('Introduction');
    fireEvent.click(lesson);

    expect(defaultProps.onLessonSelect).toHaveBeenCalledWith('1');
  });

  it('should show last accessed date', () => {
    renderWithProviders(<ProgressTracker {...defaultProps} />);

    expect(screen.getByText(/last accessed/i)).toBeInTheDocument();
    expect(screen.getByText('Oct 15, 2023')).toBeInTheDocument();
  });

  it('should display achievement badges', () => {
    const progressWithAchievements = {
      ...mockProgressData,
      achievements: [
        { id: '1', title: 'First Lesson', description: 'Completed first lesson', earnedAt: new Date().toISOString() },
        { id: '2', title: 'Speed Learner', description: 'Completed 5 lessons in one day', earnedAt: new Date().toISOString() }
      ]
    };

    renderWithProviders(
      <ProgressTracker {...defaultProps} progressData={progressWithAchievements} />
    );

    expect(screen.getByText('Achievements')).toBeInTheDocument();
    expect(screen.getByText('First Lesson')).toBeInTheDocument();
    expect(screen.getByText('Speed Learner')).toBeInTheDocument();
  });

  it('should show learning streak', () => {
    const progressWithStreak = {
      ...mockProgressData,
      learningStreak: {
        current: 7,
        longest: 15
      }
    };

    renderWithProviders(
      <ProgressTracker {...defaultProps} progressData={progressWithStreak} />
    );

    expect(screen.getByText(/7 day streak/i)).toBeInTheDocument();
    expect(screen.getByText(/longest: 15 days/i)).toBeInTheDocument();
  });

  it('should handle progress reset', async () => {
    renderWithProviders(<ProgressTracker {...defaultProps} />);

    const resetButton = screen.getByRole('button', { name: /reset progress/i });
    fireEvent.click(resetButton);

    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
    });

    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);

    expect(defaultProps.onResetProgress).toHaveBeenCalled();
  });

  it('should display weekly progress chart', () => {
    const progressWithChart = {
      ...mockProgressData,
      weeklyProgress: [
        { week: 40, lessonsCompleted: 3, timeSpent: 1800 },
        { week: 41, lessonsCompleted: 2, timeSpent: 1200 },
        { week: 42, lessonsCompleted: 1, timeSpent: 600 }
      ]
    };

    renderWithProviders(
      <ProgressTracker {...defaultProps} progressData={progressWithChart} />
    );

    expect(screen.getByText('Weekly Progress')).toBeInTheDocument();
    expect(screen.getByTestId('progress-chart')).toBeInTheDocument();
  });

  it('should show completion certificate option', () => {
    const completedProgress = {
      ...mockProgressData,
      completionPercentage: 100,
      completedLessons: 10,
      certificateAvailable: true
    };

    renderWithProviders(
      <ProgressTracker {...defaultProps} progressData={completedProgress} />
    );

    expect(screen.getByText(/congratulations/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download certificate/i })).toBeInTheDocument();
  });

  it('should handle certificate download', () => {
    const completedProgress = {
      ...mockProgressData,
      completionPercentage: 100,
      completedLessons: 10,
      certificateAvailable: true
    };

    const mockOnCertificateDownload = jest.fn();

    renderWithProviders(
      <ProgressTracker 
        {...defaultProps} 
        progressData={completedProgress}
        onCertificateDownload={mockOnCertificateDownload}
      />
    );

    const downloadButton = screen.getByRole('button', { name: /download certificate/i });
    fireEvent.click(downloadButton);

    expect(mockOnCertificateDownload).toHaveBeenCalledWith('1');
  });

  it('should show study recommendations', () => {
    const progressWithRecommendations = {
      ...mockProgressData,
      recommendations: [
        'Focus more time on Advanced Concepts',
        'Review JavaScript Basics',
        'Practice coding exercises daily'
      ]
    };

    renderWithProviders(
      <ProgressTracker {...defaultProps} progressData={progressWithRecommendations} />
    );

    expect(screen.getByText('Study Recommendations')).toBeInTheDocument();
    expect(screen.getByText('Focus more time on Advanced Concepts')).toBeInTheDocument();
  });

  it('should display progress milestones', () => {
    const progressWithMilestones = {
      ...mockProgressData,
      milestones: [
        { percentage: 25, title: 'Getting Started', achieved: true, achievedAt: '2023-10-10' },
        { percentage: 50, title: 'Halfway There', achieved: true, achievedAt: '2023-10-12' },
        { percentage: 75, title: 'Almost Done', achieved: false, achievedAt: null },
        { percentage: 100, title: 'Course Complete', achieved: false, achievedAt: null }
      ]
    };

    renderWithProviders(
      <ProgressTracker {...defaultProps} progressData={progressWithMilestones} />
    );

    expect(screen.getByText('Milestones')).toBeInTheDocument();
    expect(screen.getByText('Getting Started')).toBeInTheDocument();
    expect(screen.getByText('Halfway There')).toBeInTheDocument();

    // Check achievement icons
    const achievedMilestones = screen.getAllByTestId('trophy-icon');
    expect(achievedMilestones).toHaveLength(2);
  });

  it('should be accessible', () => {
    renderWithProviders(<ProgressTracker {...defaultProps} />);

    // Check ARIA labels
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-label', 'Course completion progress: 60%');

    // Check keyboard navigation
    const lessons = screen.getAllByRole('button', { name: /lesson/i });
    lessons.forEach(lesson => {
      expect(lesson).toHaveAttribute('tabIndex', '0');
    });

    // Check screen reader text
    expect(screen.getByText('6 out of 10 lessons completed')).toBeInTheDocument();
  });

  it('should handle loading state', () => {
    renderWithProviders(
      <ProgressTracker {...defaultProps} progressData={null} loading={true} />
    );

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.getByText(/loading progress/i)).toBeInTheDocument();
  });

  it('should handle error state', () => {
    renderWithProviders(
      <ProgressTracker 
        {...defaultProps} 
        progressData={null} 
        error="Failed to load progress data" 
      />
    );

    expect(screen.getByText(/failed to load progress data/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('should show progress comparison with other students', () => {
    const progressWithComparison = {
      ...mockProgressData,
      percentileRank: 75
    };

    renderWithProviders(
      <ProgressTracker {...defaultProps} progressData={progressWithComparison} />
    );

    expect(screen.getByText(/better than 75% of students/i)).toBeInTheDocument();
  });

  it('should display estimated time to completion', () => {
    const progressWithEstimate = {
      ...mockProgressData,
      estimatedTimeToCompletion: 2400 // 40 minutes
    };

    renderWithProviders(
      <ProgressTracker {...defaultProps} progressData={progressWithEstimate} />
    );

    expect(screen.getByText(/estimated time to complete/i)).toBeInTheDocument();
    expect(screen.getByText('40m remaining')).toBeInTheDocument();
  });
});