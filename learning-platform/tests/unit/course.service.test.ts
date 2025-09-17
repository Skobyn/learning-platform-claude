import { CourseService } from '../../src/services/course.service';
import { mockCourse } from '../utils/test-helpers';

// Mock axios
jest.mock('axios');

describe('CourseService', () => {
  let courseService: CourseService;
  let mockAxios: any;

  beforeEach(() => {
    const axios = require('axios');
    mockAxios = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn()
    };
    axios.create = jest.fn().mockReturnValue(mockAxios);
    
    courseService = new CourseService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCourses', () => {
    const mockCoursesResponse = {
      courses: [mockCourse],
      total: 1,
      page: 1,
      totalPages: 1
    };

    it('should fetch courses with default parameters', async () => {
      mockAxios.get.mockResolvedValue({ data: mockCoursesResponse });

      const result = await courseService.getCourses();

      expect(mockAxios.get).toHaveBeenCalledWith('/courses', {
        params: {
          page: 1,
          limit: 12,
          search: '',
          level: '',
          sortBy: 'createdAt',
          sortOrder: 'desc'
        }
      });
      expect(result).toEqual(mockCoursesResponse);
    });

    it('should fetch courses with custom parameters', async () => {
      mockAxios.get.mockResolvedValue({ data: mockCoursesResponse });

      const params = {
        page: 2,
        limit: 20,
        search: 'javascript',
        level: 'beginner',
        sortBy: 'title',
        sortOrder: 'asc'
      };

      const result = await courseService.getCourses(params);

      expect(mockAxios.get).toHaveBeenCalledWith('/courses', { params });
      expect(result).toEqual(mockCoursesResponse);
    });

    it('should handle API errors', async () => {
      mockAxios.get.mockRejectedValue({
        response: {
          status: 500,
          data: { message: 'Internal server error' }
        }
      });

      await expect(courseService.getCourses()).rejects.toThrow();
    });

    it('should validate pagination parameters', async () => {
      const invalidParams = {
        page: -1,
        limit: 0
      };

      await expect(courseService.getCourses(invalidParams)).rejects.toThrow('Invalid pagination parameters');
      expect(mockAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('getCourseById', () => {
    it('should fetch course by ID', async () => {
      mockAxios.get.mockResolvedValue({ data: mockCourse });

      const result = await courseService.getCourseById('1');

      expect(mockAxios.get).toHaveBeenCalledWith('/courses/1');
      expect(result).toEqual(mockCourse);
    });

    it('should handle course not found', async () => {
      mockAxios.get.mockRejectedValue({
        response: {
          status: 404,
          data: { message: 'Course not found' }
        }
      });

      await expect(courseService.getCourseById('999')).rejects.toThrow('Course not found');
    });

    it('should validate course ID', async () => {
      await expect(courseService.getCourseById('')).rejects.toThrow('Course ID is required');
      expect(mockAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('searchCourses', () => {
    const mockSearchResponse = {
      courses: [mockCourse],
      total: 1,
      suggestions: ['JavaScript', 'React', 'Node.js']
    };

    it('should search courses by query', async () => {
      mockAxios.get.mockResolvedValue({ data: mockSearchResponse });

      const result = await courseService.searchCourses('javascript');

      expect(mockAxios.get).toHaveBeenCalledWith('/courses/search', {
        params: {
          q: 'javascript',
          limit: 10,
          includeContent: false
        }
      });
      expect(result).toEqual(mockSearchResponse);
    });

    it('should search with options', async () => {
      mockAxios.get.mockResolvedValue({ data: mockSearchResponse });

      const options = {
        limit: 20,
        includeContent: true
      };

      const result = await courseService.searchCourses('javascript', options);

      expect(mockAxios.get).toHaveBeenCalledWith('/courses/search', {
        params: {
          q: 'javascript',
          ...options
        }
      });
    });

    it('should validate search query', async () => {
      await expect(courseService.searchCourses('')).rejects.toThrow('Search query is required');
      expect(mockAxios.get).not.toHaveBeenCalled();
    });

    it('should handle empty search results', async () => {
      const emptyResponse = {
        courses: [],
        total: 0,
        suggestions: []
      };
      
      mockAxios.get.mockResolvedValue({ data: emptyResponse });

      const result = await courseService.searchCourses('nonexistent');

      expect(result).toEqual(emptyResponse);
    });
  });

  describe('getCoursesByInstructor', () => {
    it('should fetch courses by instructor', async () => {
      const mockInstructorCoursesResponse = {
        courses: [mockCourse],
        total: 1
      };
      
      mockAxios.get.mockResolvedValue({ data: mockInstructorCoursesResponse });

      const result = await courseService.getCoursesByInstructor('instructor-1');

      expect(mockAxios.get).toHaveBeenCalledWith('/instructors/instructor-1/courses');
      expect(result).toEqual(mockInstructorCoursesResponse);
    });

    it('should validate instructor ID', async () => {
      await expect(courseService.getCoursesByInstructor('')).rejects.toThrow('Instructor ID is required');
    });
  });

  describe('getCourseLessons', () => {
    const mockLessons = [
      {
        id: '1',
        title: 'Introduction',
        content: 'Course introduction',
        type: 'video',
        duration: 300,
        order: 1,
        courseId: '1'
      },
      {
        id: '2',
        title: 'Getting Started',
        content: 'Getting started with the course',
        type: 'text',
        duration: 600,
        order: 2,
        courseId: '1'
      }
    ];

    it('should fetch course lessons', async () => {
      mockAxios.get.mockResolvedValue({ data: { lessons: mockLessons } });

      const result = await courseService.getCourseLessons('1');

      expect(mockAxios.get).toHaveBeenCalledWith('/courses/1/lessons');
      expect(result).toEqual(mockLessons);
    });

    it('should handle course with no lessons', async () => {
      mockAxios.get.mockResolvedValue({ data: { lessons: [] } });

      const result = await courseService.getCourseLessons('1');

      expect(result).toEqual([]);
    });
  });

  describe('getLessonById', () => {
    const mockLesson = {
      id: '1',
      title: 'Introduction',
      content: 'Course introduction content',
      type: 'video',
      duration: 300,
      order: 1,
      courseId: '1',
      resources: [],
      quiz: null
    };

    it('should fetch lesson by ID', async () => {
      mockAxios.get.mockResolvedValue({ data: mockLesson });

      const result = await courseService.getLessonById('1', '1');

      expect(mockAxios.get).toHaveBeenCalledWith('/courses/1/lessons/1');
      expect(result).toEqual(mockLesson);
    });

    it('should validate parameters', async () => {
      await expect(courseService.getLessonById('', '1')).rejects.toThrow('Course ID is required');
      await expect(courseService.getLessonById('1', '')).rejects.toThrow('Lesson ID is required');
    });
  });

  describe('getCourseReviews', () => {
    const mockReviews = [
      {
        id: '1',
        userId: '1',
        courseId: '1',
        rating: 5,
        comment: 'Excellent course!',
        createdAt: new Date().toISOString(),
        user: {
          name: 'John Doe',
          avatar: null
        }
      }
    ];

    it('should fetch course reviews', async () => {
      mockAxios.get.mockResolvedValue({ data: { reviews: mockReviews, total: 1 } });

      const result = await courseService.getCourseReviews('1');

      expect(mockAxios.get).toHaveBeenCalledWith('/courses/1/reviews', {
        params: { page: 1, limit: 10 }
      });
      expect(result.reviews).toEqual(mockReviews);
    });

    it('should fetch reviews with pagination', async () => {
      mockAxios.get.mockResolvedValue({ data: { reviews: mockReviews, total: 1 } });

      const result = await courseService.getCourseReviews('1', 2, 5);

      expect(mockAxios.get).toHaveBeenCalledWith('/courses/1/reviews', {
        params: { page: 2, limit: 5 }
      });
    });
  });

  describe('addCourseReview', () => {
    const reviewData = {
      rating: 5,
      comment: 'Great course!'
    };

    const mockReview = {
      id: '1',
      userId: '1',
      courseId: '1',
      ...reviewData,
      createdAt: new Date().toISOString()
    };

    it('should add course review', async () => {
      mockAxios.post.mockResolvedValue({ data: mockReview });

      const result = await courseService.addCourseReview('1', reviewData);

      expect(mockAxios.post).toHaveBeenCalledWith('/courses/1/reviews', reviewData);
      expect(result).toEqual(mockReview);
    });

    it('should validate review data', async () => {
      const invalidReview = {
        rating: 6, // Invalid rating
        comment: ''
      };

      await expect(courseService.addCourseReview('1', invalidReview)).rejects.toThrow('Invalid rating');
    });

    it('should handle duplicate review', async () => {
      mockAxios.post.mockRejectedValue({
        response: {
          status: 409,
          data: { message: 'Review already exists' }
        }
      });

      await expect(courseService.addCourseReview('1', reviewData)).rejects.toThrow('Review already exists');
    });
  });

  describe('getCourseCategories', () => {
    const mockCategories = [
      { id: '1', name: 'Programming', count: 25 },
      { id: '2', name: 'Design', count: 15 },
      { id: '3', name: 'Business', count: 10 }
    ];

    it('should fetch course categories', async () => {
      mockAxios.get.mockResolvedValue({ data: { categories: mockCategories } });

      const result = await courseService.getCourseCategories();

      expect(mockAxios.get).toHaveBeenCalledWith('/courses/categories');
      expect(result).toEqual(mockCategories);
    });
  });

  describe('getFeaturedCourses', () => {
    it('should fetch featured courses', async () => {
      mockAxios.get.mockResolvedValue({ data: { courses: [mockCourse] } });

      const result = await courseService.getFeaturedCourses();

      expect(mockAxios.get).toHaveBeenCalledWith('/courses/featured', {
        params: { limit: 6 }
      });
      expect(result).toEqual([mockCourse]);
    });

    it('should fetch featured courses with custom limit', async () => {
      mockAxios.get.mockResolvedValue({ data: { courses: [mockCourse] } });

      const result = await courseService.getFeaturedCourses(10);

      expect(mockAxios.get).toHaveBeenCalledWith('/courses/featured', {
        params: { limit: 10 }
      });
    });
  });
});