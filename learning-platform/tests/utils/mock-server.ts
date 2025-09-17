import { rest } from 'msw';
import { setupServer } from 'msw/node';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

// Mock data
const mockUsers = [
  {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'student',
    avatar: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '2',
    email: 'admin@example.com',
    name: 'Admin User',
    role: 'admin',
    avatar: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const mockCourses = [
  {
    id: '1',
    title: 'JavaScript Fundamentals',
    description: 'Learn the basics of JavaScript programming',
    price: 99.99,
    level: 'beginner',
    duration: 3600,
    rating: 4.5,
    studentCount: 150,
    instructorId: '2',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lessons: [
      {
        id: '1',
        title: 'Variables and Data Types',
        content: 'Understanding JavaScript variables',
        type: 'video',
        duration: 900,
        order: 1,
        courseId: '1'
      }
    ]
  }
];

const mockEnrollments = [
  {
    id: '1',
    userId: '1',
    courseId: '1',
    enrolledAt: new Date().toISOString(),
    completedAt: null,
    progress: 0
  }
];

const mockProgress = [
  {
    id: '1',
    userId: '1',
    lessonId: '1',
    completed: false,
    completedAt: null,
    timeSpent: 300
  }
];

// Request handlers
export const handlers = [
  // Authentication
  rest.post(`${API_URL}/auth/login`, (req, res, ctx) => {
    const { email, password } = req.body as any;
    const user = mockUsers.find(u => u.email === email);
    
    if (user && password === 'password') {
      return res(
        ctx.json({
          user,
          token: 'mock-jwt-token',
          refreshToken: 'mock-refresh-token'
        })
      );
    }
    
    return res(
      ctx.status(401),
      ctx.json({ message: 'Invalid credentials' })
    );
  }),

  rest.post(`${API_URL}/auth/register`, (req, res, ctx) => {
    const userData = req.body as any;
    const newUser = {
      id: String(mockUsers.length + 1),
      ...userData,
      role: 'student',
      avatar: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    mockUsers.push(newUser);
    
    return res(
      ctx.status(201),
      ctx.json({
        user: newUser,
        token: 'mock-jwt-token',
        refreshToken: 'mock-refresh-token'
      })
    );
  }),

  rest.post(`${API_URL}/auth/refresh`, (req, res, ctx) => {
    return res(
      ctx.json({
        token: 'new-mock-jwt-token',
        refreshToken: 'new-mock-refresh-token'
      })
    );
  }),

  // User endpoints
  rest.get(`${API_URL}/users/me`, (req, res, ctx) => {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return res(ctx.status(401), ctx.json({ message: 'Unauthorized' }));
    }
    
    return res(ctx.json(mockUsers[0]));
  }),

  // Course endpoints
  rest.get(`${API_URL}/courses`, (req, res, ctx) => {
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '10');
    const search = url.searchParams.get('search');
    const level = url.searchParams.get('level');
    
    let filteredCourses = mockCourses;
    
    if (search) {
      filteredCourses = filteredCourses.filter(course =>
        course.title.toLowerCase().includes(search.toLowerCase()) ||
        course.description.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    if (level) {
      filteredCourses = filteredCourses.filter(course => course.level === level);
    }
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedCourses = filteredCourses.slice(startIndex, endIndex);
    
    return res(
      ctx.json({
        courses: paginatedCourses,
        total: filteredCourses.length,
        page,
        totalPages: Math.ceil(filteredCourses.length / limit)
      })
    );
  }),

  rest.get(`${API_URL}/courses/:id`, (req, res, ctx) => {
    const { id } = req.params;
    const course = mockCourses.find(c => c.id === id);
    
    if (!course) {
      return res(ctx.status(404), ctx.json({ message: 'Course not found' }));
    }
    
    return res(ctx.json(course));
  }),

  // Enrollment endpoints
  rest.post(`${API_URL}/enrollments`, (req, res, ctx) => {
    const { courseId } = req.body as any;
    const newEnrollment = {
      id: String(mockEnrollments.length + 1),
      userId: '1',
      courseId,
      enrolledAt: new Date().toISOString(),
      completedAt: null,
      progress: 0
    };
    
    mockEnrollments.push(newEnrollment);
    
    return res(ctx.status(201), ctx.json(newEnrollment));
  }),

  rest.get(`${API_URL}/enrollments`, (req, res, ctx) => {
    return res(ctx.json(mockEnrollments));
  }),

  // Progress endpoints
  rest.post(`${API_URL}/progress`, (req, res, ctx) => {
    const progressData = req.body as any;
    const newProgress = {
      id: String(mockProgress.length + 1),
      userId: '1',
      ...progressData,
      completedAt: progressData.completed ? new Date().toISOString() : null
    };
    
    mockProgress.push(newProgress);
    
    return res(ctx.status(201), ctx.json(newProgress));
  }),

  rest.get(`${API_URL}/progress`, (req, res, ctx) => {
    const url = new URL(req.url);
    const courseId = url.searchParams.get('courseId');
    
    let filteredProgress = mockProgress;
    
    if (courseId) {
      const course = mockCourses.find(c => c.id === courseId);
      if (course) {
        const lessonIds = course.lessons.map(l => l.id);
        filteredProgress = filteredProgress.filter(p => lessonIds.includes(p.lessonId));
      }
    }
    
    return res(ctx.json(filteredProgress));
  }),

  // Analytics endpoints
  rest.get(`${API_URL}/analytics/progress`, (req, res, ctx) => {
    return res(
      ctx.json({
        totalCourses: mockCourses.length,
        completedCourses: mockEnrollments.filter(e => e.completedAt).length,
        totalTimeSpent: mockProgress.reduce((sum, p) => sum + p.timeSpent, 0),
        averageCompletion: 0.65
      })
    );
  })
];

// Setup server
export const server = setupServer(...handlers);