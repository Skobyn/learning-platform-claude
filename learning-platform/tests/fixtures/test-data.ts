export const testUsers = {
  student: {
    id: '1',
    email: 'student@example.com',
    name: 'Test Student',
    role: 'student',
    avatar: null,
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z'
  },
  instructor: {
    id: '2',
    email: 'instructor@example.com',
    name: 'Test Instructor',
    role: 'instructor',
    avatar: 'https://example.com/avatar.jpg',
    bio: 'Experienced instructor with 10+ years in the field',
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z'
  },
  admin: {
    id: '3',
    email: 'admin@example.com',
    name: 'Test Admin',
    role: 'admin',
    avatar: null,
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z'
  }
};

export const testCourses = {
  javascript: {
    id: '1',
    title: 'JavaScript Fundamentals',
    description: 'Learn the basics of JavaScript programming language',
    price: 99.99,
    discountedPrice: null,
    level: 'beginner',
    duration: 3600,
    rating: 4.5,
    studentCount: 150,
    instructorId: '2',
    thumbnail: 'https://example.com/js-course.jpg',
    featured: true,
    published: true,
    tags: ['JavaScript', 'Programming', 'Web Development'],
    prerequisites: ['Basic HTML', 'Basic CSS'],
    learningObjectives: [
      'Understand JavaScript syntax and fundamentals',
      'Work with variables, functions, and objects',
      'Handle DOM manipulation',
      'Debug JavaScript code effectively'
    ],
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z'
  },
  react: {
    id: '2',
    title: 'React Development',
    description: 'Master React.js for modern web development',
    price: 149.99,
    discountedPrice: 99.99,
    level: 'intermediate',
    duration: 7200,
    rating: 4.7,
    studentCount: 89,
    instructorId: '2',
    thumbnail: 'https://example.com/react-course.jpg',
    featured: false,
    published: true,
    tags: ['React', 'JavaScript', 'Frontend'],
    prerequisites: ['JavaScript Fundamentals', 'HTML/CSS'],
    learningObjectives: [
      'Build interactive React applications',
      'Understand React hooks and state management',
      'Implement routing and navigation',
      'Test React components'
    ],
    createdAt: '2023-01-15T00:00:00.000Z',
    updatedAt: '2023-01-15T00:00:00.000Z'
  },
  python: {
    id: '3',
    title: 'Python for Beginners',
    description: 'Start your programming journey with Python',
    price: 0, // Free course
    discountedPrice: null,
    level: 'beginner',
    duration: 5400,
    rating: 4.3,
    studentCount: 320,
    instructorId: '2',
    thumbnail: 'https://example.com/python-course.jpg',
    featured: true,
    published: true,
    tags: ['Python', 'Programming', 'Beginner'],
    prerequisites: [],
    learningObjectives: [
      'Learn Python syntax and basic concepts',
      'Work with data types and control structures',
      'Understand functions and modules',
      'Build simple Python applications'
    ],
    createdAt: '2023-02-01T00:00:00.000Z',
    updatedAt: '2023-02-01T00:00:00.000Z'
  }
};

export const testLessons = {
  jsIntro: {
    id: '1',
    title: 'Introduction to JavaScript',
    description: 'Learn what JavaScript is and why it\'s important',
    content: 'JavaScript is a versatile programming language...',
    type: 'video',
    duration: 900, // 15 minutes
    order: 1,
    courseId: '1',
    videoUrl: 'https://example.com/videos/js-intro.mp4',
    resources: [
      {
        id: '1',
        title: 'JavaScript Cheat Sheet',
        url: 'https://example.com/js-cheatsheet.pdf',
        type: 'pdf'
      }
    ],
    quiz: null,
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z'
  },
  jsVariables: {
    id: '2',
    title: 'Variables and Data Types',
    description: 'Understanding JavaScript variables and data types',
    content: 'In JavaScript, variables are containers for storing data...',
    type: 'text',
    duration: 1200, // 20 minutes
    order: 2,
    courseId: '1',
    videoUrl: null,
    resources: [],
    quiz: {
      id: '1',
      questions: [
        {
          id: '1',
          question: 'Which keyword is used to declare a constant in JavaScript?',
          type: 'multiple_choice',
          options: ['var', 'let', 'const', 'final'],
          correctAnswer: 'const',
          explanation: 'The const keyword is used to declare constants in JavaScript.'
        }
      ]
    },
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z'
  },
  jsFunctions: {
    id: '3',
    title: 'Functions and Scope',
    description: 'Learn about JavaScript functions and variable scope',
    content: 'Functions are reusable blocks of code...',
    type: 'interactive',
    duration: 1800, // 30 minutes
    order: 3,
    courseId: '1',
    videoUrl: 'https://example.com/videos/js-functions.mp4',
    resources: [
      {
        id: '2',
        title: 'Function Examples',
        url: 'https://example.com/function-examples.js',
        type: 'code'
      }
    ],
    quiz: {
      id: '2',
      questions: [
        {
          id: '2',
          question: 'What is the correct way to define a function in JavaScript?',
          type: 'multiple_choice',
          options: [
            'function myFunction() {}',
            'def myFunction():',
            'func myFunction() {}',
            'function = myFunction() {}'
          ],
          correctAnswer: 'function myFunction() {}',
          explanation: 'Functions in JavaScript are defined using the function keyword.'
        }
      ]
    },
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z'
  }
};

export const testEnrollments = {
  studentJavaScript: {
    id: '1',
    userId: '1',
    courseId: '1',
    enrolledAt: '2023-10-01T00:00:00.000Z',
    completedAt: null,
    progress: 60,
    lastAccessedAt: '2023-10-15T14:30:00.000Z'
  },
  studentPython: {
    id: '2',
    userId: '1',
    courseId: '3',
    enrolledAt: '2023-09-15T00:00:00.000Z',
    completedAt: '2023-10-10T00:00:00.000Z',
    progress: 100,
    lastAccessedAt: '2023-10-10T16:45:00.000Z'
  }
};

export const testProgress = {
  lesson1: {
    id: '1',
    userId: '1',
    lessonId: '1',
    completed: true,
    completedAt: '2023-10-01T10:00:00.000Z',
    timeSpent: 1200, // 20 minutes (longer than lesson duration)
    score: 95,
    notes: 'Great introduction to JavaScript concepts'
  },
  lesson2: {
    id: '2',
    userId: '1',
    lessonId: '2',
    completed: true,
    completedAt: '2023-10-02T11:30:00.000Z',
    timeSpent: 1800,
    score: 88,
    notes: 'Need to review const vs let'
  },
  lesson3: {
    id: '3',
    userId: '1',
    lessonId: '3',
    completed: false,
    completedAt: null,
    timeSpent: 600,
    score: null,
    notes: 'Functions are confusing, need more practice'
  }
};

export const testReviews = {
  jsReview1: {
    id: '1',
    userId: '1',
    courseId: '1',
    rating: 5,
    comment: 'Excellent course! Very well structured and easy to follow.',
    createdAt: '2023-10-05T00:00:00.000Z',
    updatedAt: '2023-10-05T00:00:00.000Z',
    user: testUsers.student
  },
  jsReview2: {
    id: '2',
    userId: '3',
    courseId: '1',
    rating: 4,
    comment: 'Good content, but could use more practical examples.',
    createdAt: '2023-10-03T00:00:00.000Z',
    updatedAt: '2023-10-03T00:00:00.000Z',
    user: testUsers.admin
  }
};

export const testCategories = [
  { id: '1', name: 'Programming', count: 15, slug: 'programming' },
  { id: '2', name: 'Web Development', count: 12, slug: 'web-development' },
  { id: '3', name: 'Mobile Development', count: 8, slug: 'mobile-development' },
  { id: '4', name: 'Data Science', count: 10, slug: 'data-science' },
  { id: '5', name: 'Design', count: 6, slug: 'design' },
  { id: '6', name: 'Business', count: 9, slug: 'business' }
];

export const testAchievements = [
  {
    id: '1',
    title: 'First Steps',
    description: 'Complete your first lesson',
    icon: 'trophy',
    condition: 'complete_first_lesson',
    points: 50
  },
  {
    id: '2',
    title: 'Quick Learner',
    description: 'Complete 5 lessons in one day',
    icon: 'lightning',
    condition: 'complete_5_lessons_one_day',
    points: 100
  },
  {
    id: '3',
    title: 'Course Conqueror',
    description: 'Complete your first course',
    icon: 'star',
    condition: 'complete_first_course',
    points: 200
  },
  {
    id: '4',
    title: 'Consistent Learner',
    description: 'Study for 7 days in a row',
    icon: 'calendar',
    condition: 'study_7_days_streak',
    points: 150
  }
];

export const testNotifications = [
  {
    id: '1',
    userId: '1',
    title: 'New lesson available',
    message: 'A new lesson has been added to JavaScript Fundamentals',
    type: 'course_update',
    read: false,
    createdAt: '2023-10-15T09:00:00.000Z'
  },
  {
    id: '2',
    userId: '1',
    title: 'Quiz passed!',
    message: 'You scored 88% on the Variables and Data Types quiz',
    type: 'achievement',
    read: true,
    createdAt: '2023-10-02T12:00:00.000Z'
  },
  {
    id: '3',
    userId: '1',
    title: 'Course completed',
    message: 'Congratulations! You have completed Python for Beginners',
    type: 'course_completion',
    read: true,
    createdAt: '2023-10-10T17:00:00.000Z'
  }
];

export const testCertificates = {
  pythonCertificate: {
    id: '1',
    userId: '1',
    courseId: '3',
    certificateUrl: 'https://example.com/certificates/python-cert-123.pdf',
    verificationCode: 'CERT-PY-2023-001',
    issuedAt: '2023-10-10T18:00:00.000Z'
  }
};

// API response helpers
export const createApiResponse = <T>(data: T, meta?: any) => ({
  data,
  meta: {
    timestamp: new Date().toISOString(),
    ...meta
  }
});

export const createPaginatedResponse = <T>(
  items: T[],
  page = 1,
  limit = 10,
  total?: number
) => ({
  data: items.slice((page - 1) * limit, page * limit),
  meta: {
    page,
    limit,
    total: total || items.length,
    totalPages: Math.ceil((total || items.length) / limit),
    hasNextPage: page * limit < (total || items.length),
    hasPreviousPage: page > 1
  }
});

export const createErrorResponse = (message: string, code = 400) => ({
  error: {
    message,
    code,
    timestamp: new Date().toISOString()
  }
});

// Test data generators
export const generateUser = (overrides: Partial<typeof testUsers.student> = {}) => ({
  ...testUsers.student,
  id: Math.random().toString(36).substr(2, 9),
  email: `user${Date.now()}@example.com`,
  ...overrides
});

export const generateCourse = (overrides: Partial<typeof testCourses.javascript> = {}) => ({
  ...testCourses.javascript,
  id: Math.random().toString(36).substr(2, 9),
  title: `Course ${Date.now()}`,
  ...overrides
});

export const generateLesson = (courseId: string, overrides: Partial<typeof testLessons.jsIntro> = {}) => ({
  ...testLessons.jsIntro,
  id: Math.random().toString(36).substr(2, 9),
  title: `Lesson ${Date.now()}`,
  courseId,
  ...overrides
});

export const generateProgress = (
  userId: string,
  lessonId: string,
  overrides: Partial<typeof testProgress.lesson1> = {}
) => ({
  ...testProgress.lesson1,
  id: Math.random().toString(36).substr(2, 9),
  userId,
  lessonId,
  ...overrides
});

// Database seed data for tests
export const seedData = {
  users: Object.values(testUsers),
  courses: Object.values(testCourses),
  lessons: Object.values(testLessons),
  enrollments: Object.values(testEnrollments),
  progress: Object.values(testProgress),
  reviews: Object.values(testReviews),
  categories: testCategories,
  achievements: testAchievements,
  notifications: testNotifications,
  certificates: Object.values(testCertificates)
};