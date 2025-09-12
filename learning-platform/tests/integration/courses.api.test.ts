import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

describe('Courses API Integration Tests', () => {
  let authToken: string;
  let userId: string;
  let courseId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$transaction([
      prisma.enrollment.deleteMany(),
      prisma.lesson.deleteMany(),
      prisma.course.deleteMany(),
      prisma.user.deleteMany()
    ]);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up
    await prisma.$transaction([
      prisma.enrollment.deleteMany(),
      prisma.lesson.deleteMany(),
      prisma.course.deleteMany(),
      prisma.user.deleteMany()
    ]);

    // Create test user and get auth token
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      });

    authToken = registerResponse.body.token;
    userId = registerResponse.body.user.id;

    // Create test course
    const courseResponse = await request(app)
      .post('/api/courses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        title: 'Test Course',
        description: 'A test course for integration testing',
        price: 99.99,
        level: 'beginner',
        duration: 3600
      });

    courseId = courseResponse.body.id;
  });

  describe('GET /api/courses', () => {
    beforeEach(async () => {
      // Create additional courses for testing
      await Promise.all([
        request(app)
          .post('/api/courses')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            title: 'Advanced JavaScript',
            description: 'Advanced JavaScript concepts',
            price: 149.99,
            level: 'advanced',
            duration: 7200
          }),
        request(app)
          .post('/api/courses')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            title: 'React Fundamentals',
            description: 'Learn React from scratch',
            price: 199.99,
            level: 'intermediate',
            duration: 5400
          })
      ]);
    });

    it('should return paginated courses', async () => {
      const response = await request(app)
        .get('/api/courses')
        .expect(200);

      expect(response.body).toHaveProperty('courses');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('totalPages');
      expect(response.body.courses).toHaveLength(3);
      expect(response.body.total).toBe(3);
    });

    it('should filter courses by level', async () => {
      const response = await request(app)
        .get('/api/courses?level=advanced')
        .expect(200);

      expect(response.body.courses).toHaveLength(1);
      expect(response.body.courses[0].level).toBe('advanced');
    });

    it('should search courses by title', async () => {
      const response = await request(app)
        .get('/api/courses?search=React')
        .expect(200);

      expect(response.body.courses).toHaveLength(1);
      expect(response.body.courses[0].title).toContain('React');
    });

    it('should sort courses by price', async () => {
      const response = await request(app)
        .get('/api/courses?sortBy=price&sortOrder=asc')
        .expect(200);

      const prices = response.body.courses.map((c: any) => c.price);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    it('should paginate courses correctly', async () => {
      const response = await request(app)
        .get('/api/courses?page=1&limit=2')
        .expect(200);

      expect(response.body.courses).toHaveLength(2);
      expect(response.body.page).toBe(1);
      expect(response.body.totalPages).toBe(2);
    });

    it('should return 400 for invalid pagination parameters', async () => {
      const response = await request(app)
        .get('/api/courses?page=-1')
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });
  });

  describe('GET /api/courses/:id', () => {
    it('should return course details', async () => {
      const response = await request(app)
        .get(`/api/courses/${courseId}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', courseId);
      expect(response.body).toHaveProperty('title', 'Test Course');
      expect(response.body).toHaveProperty('description');
      expect(response.body).toHaveProperty('price', 99.99);
      expect(response.body).toHaveProperty('level', 'beginner');
      expect(response.body).toHaveProperty('lessons');
    });

    it('should return 404 for non-existent course', async () => {
      const response = await request(app)
        .get('/api/courses/non-existent-id')
        .expect(404);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Course not found');
    });

    it('should include lessons in course details', async () => {
      // Add lessons to the course
      await request(app)
        .post(`/api/courses/${courseId}/lessons`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Introduction',
          content: 'Course introduction',
          type: 'video',
          duration: 300,
          order: 1
        });

      const response = await request(app)
        .get(`/api/courses/${courseId}`)
        .expect(200);

      expect(response.body.lessons).toHaveLength(1);
      expect(response.body.lessons[0].title).toBe('Introduction');
    });
  });

  describe('POST /api/courses', () => {
    const validCourseData = {
      title: 'New Test Course',
      description: 'A new course for testing',
      price: 129.99,
      level: 'intermediate',
      duration: 4800
    };

    it('should create a new course', async () => {
      const response = await request(app)
        .post('/api/courses')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validCourseData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.title).toBe(validCourseData.title);
      expect(response.body.price).toBe(validCourseData.price);

      // Verify in database
      const course = await prisma.course.findUnique({
        where: { id: response.body.id }
      });
      expect(course).toBeTruthy();
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/courses')
        .send(validCourseData)
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 400 for invalid data', async () => {
      const response = await request(app)
        .post('/api/courses')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...validCourseData,
          price: -100 // Invalid negative price
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/courses')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          description: 'Missing title'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should validate course level', async () => {
      const response = await request(app)
        .post('/api/courses')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...validCourseData,
          level: 'invalid-level'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });
  });

  describe('PUT /api/courses/:id', () => {
    const updateData = {
      title: 'Updated Course Title',
      price: 199.99
    };

    it('should update course', async () => {
      const response = await request(app)
        .put(`/api/courses/${courseId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.title).toBe(updateData.title);
      expect(response.body.price).toBe(updateData.price);

      // Verify in database
      const course = await prisma.course.findUnique({
        where: { id: courseId }
      });
      expect(course?.title).toBe(updateData.title);
      expect(course?.price).toBe(updateData.price);
    });

    it('should return 404 for non-existent course', async () => {
      const response = await request(app)
        .put('/api/courses/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(404);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .put(`/api/courses/${courseId}`)
        .send(updateData)
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });
  });

  describe('DELETE /api/courses/:id', () => {
    it('should delete course', async () => {
      const response = await request(app)
        .delete(`/api/courses/${courseId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('message');

      // Verify course is deleted
      const course = await prisma.course.findUnique({
        where: { id: courseId }
      });
      expect(course).toBeNull();
    });

    it('should return 404 for non-existent course', async () => {
      const response = await request(app)
        .delete('/api/courses/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .delete(`/api/courses/${courseId}`)
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });

    it('should handle course with enrollments', async () => {
      // Enroll user in course
      await request(app)
        .post('/api/enrollments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ courseId });

      const response = await request(app)
        .delete(`/api/courses/${courseId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(409);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('enrolled students');
    });
  });

  describe('POST /api/courses/:id/lessons', () => {
    const lessonData = {
      title: 'Test Lesson',
      content: 'Lesson content',
      type: 'video',
      duration: 600,
      order: 1
    };

    it('should add lesson to course', async () => {
      const response = await request(app)
        .post(`/api/courses/${courseId}/lessons`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(lessonData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.title).toBe(lessonData.title);
      expect(response.body.courseId).toBe(courseId);

      // Verify in database
      const lesson = await prisma.lesson.findUnique({
        where: { id: response.body.id }
      });
      expect(lesson).toBeTruthy();
    });

    it('should return 404 for non-existent course', async () => {
      const response = await request(app)
        .post('/api/courses/non-existent-id/lessons')
        .set('Authorization', `Bearer ${authToken}`)
        .send(lessonData)
        .expect(404);

      expect(response.body).toHaveProperty('message');
    });

    it('should validate lesson type', async () => {
      const response = await request(app)
        .post(`/api/courses/${courseId}/lessons`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...lessonData,
          type: 'invalid-type'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });
  });

  describe('GET /api/courses/:id/reviews', () => {
    beforeEach(async () => {
      // Create and enroll another user for reviews
      const user2Response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'User Two',
          email: 'user2@example.com',
          password: 'password123'
        });

      const user2Token = user2Response.body.token;

      // Enroll users
      await request(app)
        .post('/api/enrollments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ courseId });

      await request(app)
        .post('/api/enrollments')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ courseId });

      // Add reviews
      await request(app)
        .post(`/api/courses/${courseId}/reviews`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          rating: 5,
          comment: 'Excellent course!'
        });

      await request(app)
        .post(`/api/courses/${courseId}/reviews`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          rating: 4,
          comment: 'Very good course'
        });
    });

    it('should return course reviews', async () => {
      const response = await request(app)
        .get(`/api/courses/${courseId}/reviews`)
        .expect(200);

      expect(response.body).toHaveProperty('reviews');
      expect(response.body).toHaveProperty('total');
      expect(response.body.reviews).toHaveLength(2);
      expect(response.body.total).toBe(2);

      const review = response.body.reviews[0];
      expect(review).toHaveProperty('rating');
      expect(review).toHaveProperty('comment');
      expect(review).toHaveProperty('user');
      expect(review.user).toHaveProperty('name');
    });

    it('should paginate reviews', async () => {
      const response = await request(app)
        .get(`/api/courses/${courseId}/reviews?limit=1`)
        .expect(200);

      expect(response.body.reviews).toHaveLength(1);
    });

    it('should return empty array for course with no reviews', async () => {
      // Create new course without reviews
      const newCourseResponse = await request(app)
        .post('/api/courses')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Course Without Reviews',
          description: 'No reviews yet',
          price: 99.99,
          level: 'beginner',
          duration: 3600
        });

      const response = await request(app)
        .get(`/api/courses/${newCourseResponse.body.id}/reviews`)
        .expect(200);

      expect(response.body.reviews).toHaveLength(0);
      expect(response.body.total).toBe(0);
    });
  });

  describe('GET /api/courses/featured', () => {
    beforeEach(async () => {
      // Create additional featured courses
      await Promise.all([
        request(app)
          .post('/api/courses')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            title: 'Featured Course 1',
            description: 'Featured course',
            price: 149.99,
            level: 'advanced',
            duration: 7200,
            featured: true
          }),
        request(app)
          .post('/api/courses')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            title: 'Featured Course 2',
            description: 'Another featured course',
            price: 199.99,
            level: 'intermediate',
            duration: 5400,
            featured: true
          })
      ]);
    });

    it('should return featured courses', async () => {
      const response = await request(app)
        .get('/api/courses/featured')
        .expect(200);

      expect(response.body).toHaveProperty('courses');
      expect(response.body.courses.length).toBeGreaterThan(0);
      
      // All returned courses should be featured
      response.body.courses.forEach((course: any) => {
        expect(course.featured).toBe(true);
      });
    });

    it('should limit featured courses', async () => {
      const response = await request(app)
        .get('/api/courses/featured?limit=1')
        .expect(200);

      expect(response.body.courses).toHaveLength(1);
    });
  });
});