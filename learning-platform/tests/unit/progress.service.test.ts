import { ProgressService } from '../../src/services/progress.service';

// Mock axios
jest.mock('axios');

describe('ProgressService', () => {
  let progressService: ProgressService;
  let mockAxios: any;

  const mockProgressData = {
    id: '1',
    userId: '1',
    lessonId: '1',
    completed: true,
    completedAt: new Date().toISOString(),
    timeSpent: 1200,
    score: 85
  };

  const mockCourseProgress = {
    courseId: '1',
    totalLessons: 10,
    completedLessons: 6,
    completionPercentage: 60,
    totalTimeSpent: 7200,
    lastAccessed: new Date().toISOString(),
    averageScore: 82
  };

  beforeEach(() => {
    const axios = require('axios');
    mockAxios = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn()
    };
    axios.create = jest.fn().mockReturnValue(mockAxios);
    
    progressService = new ProgressService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('trackLessonProgress', () => {
    const progressData = {
      lessonId: '1',
      completed: true,
      timeSpent: 1200,
      score: 85
    };

    it('should track lesson progress successfully', async () => {
      mockAxios.post.mockResolvedValue({ data: mockProgressData });

      const result = await progressService.trackLessonProgress(progressData);

      expect(mockAxios.post).toHaveBeenCalledWith('/progress', progressData);
      expect(result).toEqual(mockProgressData);
    });

    it('should validate required fields', async () => {
      const invalidData = {
        completed: true,
        timeSpent: 1200
        // missing lessonId
      };

      await expect(progressService.trackLessonProgress(invalidData as any))
        .rejects.toThrow('Lesson ID is required');
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it('should validate time spent', async () => {
      const invalidData = {
        lessonId: '1',
        completed: true,
        timeSpent: -100 // Invalid negative time
      };

      await expect(progressService.trackLessonProgress(invalidData))
        .rejects.toThrow('Time spent must be a positive number');
    });

    it('should validate score range', async () => {
      const invalidData = {
        lessonId: '1',
        completed: true,
        timeSpent: 1200,
        score: 150 // Invalid score > 100
      };

      await expect(progressService.trackLessonProgress(invalidData))
        .rejects.toThrow('Score must be between 0 and 100');
    });

    it('should handle API errors', async () => {
      mockAxios.post.mockRejectedValue({
        response: {
          status: 500,
          data: { message: 'Internal server error' }
        }
      });

      await expect(progressService.trackLessonProgress(progressData))
        .rejects.toThrow('Internal server error');
    });
  });

  describe('getLessonProgress', () => {
    it('should get lesson progress for user', async () => {
      mockAxios.get.mockResolvedValue({ data: mockProgressData });

      const result = await progressService.getLessonProgress('1', '1');

      expect(mockAxios.get).toHaveBeenCalledWith('/progress/lesson/1', {
        params: { userId: '1' }
      });
      expect(result).toEqual(mockProgressData);
    });

    it('should return null for non-existent progress', async () => {
      mockAxios.get.mockResolvedValue({ data: null });

      const result = await progressService.getLessonProgress('999', '1');

      expect(result).toBeNull();
    });

    it('should validate parameters', async () => {
      await expect(progressService.getLessonProgress('', '1'))
        .rejects.toThrow('Lesson ID is required');
      await expect(progressService.getLessonProgress('1', ''))
        .rejects.toThrow('User ID is required');
    });
  });

  describe('getCourseProgress', () => {
    it('should get course progress for user', async () => {
      mockAxios.get.mockResolvedValue({ data: mockCourseProgress });

      const result = await progressService.getCourseProgress('1', '1');

      expect(mockAxios.get).toHaveBeenCalledWith('/progress/course/1', {
        params: { userId: '1' }
      });
      expect(result).toEqual(mockCourseProgress);
    });

    it('should handle course with no progress', async () => {
      const emptyProgress = {
        courseId: '1',
        totalLessons: 10,
        completedLessons: 0,
        completionPercentage: 0,
        totalTimeSpent: 0,
        lastAccessed: null,
        averageScore: 0
      };
      
      mockAxios.get.mockResolvedValue({ data: emptyProgress });

      const result = await progressService.getCourseProgress('1', '1');

      expect(result).toEqual(emptyProgress);
    });
  });

  describe('getUserProgress', () => {
    const mockUserProgress = {
      totalCourses: 5,
      completedCourses: 2,
      inProgressCourses: 2,
      notStartedCourses: 1,
      totalTimeSpent: 18000,
      averageCompletion: 45,
      achievements: ['First Course', 'Speed Learner'],
      recentActivity: [
        {
          type: 'lesson_completed',
          lessonId: '1',
          courseTitle: 'JavaScript Fundamentals',
          completedAt: new Date().toISOString()
        }
      ]
    };

    it('should get user overall progress', async () => {
      mockAxios.get.mockResolvedValue({ data: mockUserProgress });

      const result = await progressService.getUserProgress('1');

      expect(mockAxios.get).toHaveBeenCalledWith('/progress/user/1');
      expect(result).toEqual(mockUserProgress);
    });

    it('should get user progress with date range', async () => {
      const startDate = new Date('2023-01-01').toISOString();
      const endDate = new Date('2023-12-31').toISOString();

      mockAxios.get.mockResolvedValue({ data: mockUserProgress });

      const result = await progressService.getUserProgress('1', startDate, endDate);

      expect(mockAxios.get).toHaveBeenCalledWith('/progress/user/1', {
        params: { startDate, endDate }
      });
    });
  });

  describe('getProgressAnalytics', () => {
    const mockAnalytics = {
      dailyProgress: [
        { date: '2023-10-01', lessonsCompleted: 3, timeSpent: 3600 },
        { date: '2023-10-02', lessonsCompleted: 2, timeSpent: 2400 }
      ],
      weeklyProgress: [
        { week: 40, lessonsCompleted: 15, timeSpent: 18000 }
      ],
      monthlyProgress: [
        { month: 10, lessonsCompleted: 45, timeSpent: 54000 }
      ],
      topCategories: [
        { category: 'Programming', completion: 75 },
        { category: 'Design', completion: 50 }
      ],
      learningStreak: {
        current: 7,
        longest: 15
      }
    };

    it('should get progress analytics', async () => {
      mockAxios.get.mockResolvedValue({ data: mockAnalytics });

      const result = await progressService.getProgressAnalytics('1');

      expect(mockAxios.get).toHaveBeenCalledWith('/progress/user/1/analytics');
      expect(result).toEqual(mockAnalytics);
    });

    it('should get analytics with custom period', async () => {
      mockAxios.get.mockResolvedValue({ data: mockAnalytics });

      const result = await progressService.getProgressAnalytics('1', 'monthly');

      expect(mockAxios.get).toHaveBeenCalledWith('/progress/user/1/analytics', {
        params: { period: 'monthly' }
      });
    });
  });

  describe('updateLessonProgress', () => {
    const updateData = {
      completed: true,
      timeSpent: 1800,
      score: 90
    };

    it('should update existing lesson progress', async () => {
      const updatedProgress = { ...mockProgressData, ...updateData };
      mockAxios.put.mockResolvedValue({ data: updatedProgress });

      const result = await progressService.updateLessonProgress('1', '1', updateData);

      expect(mockAxios.put).toHaveBeenCalledWith('/progress/lesson/1', updateData, {
        params: { userId: '1' }
      });
      expect(result).toEqual(updatedProgress);
    });

    it('should handle non-existent progress', async () => {
      mockAxios.put.mockRejectedValue({
        response: {
          status: 404,
          data: { message: 'Progress not found' }
        }
      });

      await expect(progressService.updateLessonProgress('999', '1', updateData))
        .rejects.toThrow('Progress not found');
    });
  });

  describe('resetLessonProgress', () => {
    it('should reset lesson progress', async () => {
      const resetProgress = {
        ...mockProgressData,
        completed: false,
        completedAt: null,
        timeSpent: 0,
        score: null
      };
      
      mockAxios.post.mockResolvedValue({ data: resetProgress });

      const result = await progressService.resetLessonProgress('1', '1');

      expect(mockAxios.post).toHaveBeenCalledWith('/progress/lesson/1/reset', {
        userId: '1'
      });
      expect(result).toEqual(resetProgress);
    });
  });

  describe('getBatchProgress', () => {
    const lessonIds = ['1', '2', '3'];
    const mockBatchProgress = [
      { lessonId: '1', completed: true, timeSpent: 1200, score: 85 },
      { lessonId: '2', completed: false, timeSpent: 600, score: null },
      { lessonId: '3', completed: true, timeSpent: 1800, score: 92 }
    ];

    it('should get progress for multiple lessons', async () => {
      mockAxios.post.mockResolvedValue({ data: { progress: mockBatchProgress } });

      const result = await progressService.getBatchProgress('1', lessonIds);

      expect(mockAxios.post).toHaveBeenCalledWith('/progress/batch', {
        userId: '1',
        lessonIds
      });
      expect(result).toEqual(mockBatchProgress);
    });

    it('should validate lesson IDs array', async () => {
      await expect(progressService.getBatchProgress('1', []))
        .rejects.toThrow('Lesson IDs array cannot be empty');
    });

    it('should limit batch size', async () => {
      const largeBatch = Array.from({ length: 101 }, (_, i) => String(i));

      await expect(progressService.getBatchProgress('1', largeBatch))
        .rejects.toThrow('Maximum batch size is 100 lessons');
    });
  });

  describe('getLeaderboard', () => {
    const mockLeaderboard = [
      {
        userId: '1',
        userName: 'Alice Smith',
        userAvatar: null,
        totalScore: 2750,
        coursesCompleted: 5,
        rank: 1
      },
      {
        userId: '2',
        userName: 'Bob Johnson',
        userAvatar: null,
        totalScore: 2300,
        coursesCompleted: 4,
        rank: 2
      }
    ];

    it('should get course leaderboard', async () => {
      mockAxios.get.mockResolvedValue({ data: { leaderboard: mockLeaderboard } });

      const result = await progressService.getLeaderboard('1');

      expect(mockAxios.get).toHaveBeenCalledWith('/progress/course/1/leaderboard', {
        params: { limit: 10 }
      });
      expect(result).toEqual(mockLeaderboard);
    });

    it('should get leaderboard with custom limit', async () => {
      mockAxios.get.mockResolvedValue({ data: { leaderboard: mockLeaderboard } });

      const result = await progressService.getLeaderboard('1', 20);

      expect(mockAxios.get).toHaveBeenCalledWith('/progress/course/1/leaderboard', {
        params: { limit: 20 }
      });
    });
  });

  describe('getCertificate', () => {
    const mockCertificate = {
      id: '1',
      userId: '1',
      courseId: '1',
      issuedAt: new Date().toISOString(),
      certificateUrl: 'https://example.com/certificates/cert-123.pdf',
      verificationCode: 'CERT-123-456'
    };

    it('should get course certificate', async () => {
      mockAxios.get.mockResolvedValue({ data: mockCertificate });

      const result = await progressService.getCertificate('1', '1');

      expect(mockAxios.get).toHaveBeenCalledWith('/progress/course/1/certificate', {
        params: { userId: '1' }
      });
      expect(result).toEqual(mockCertificate);
    });

    it('should return null for incomplete course', async () => {
      mockAxios.get.mockResolvedValue({ data: null });

      const result = await progressService.getCertificate('1', '1');

      expect(result).toBeNull();
    });
  });
});