import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

describe('Auth API Integration Tests', () => {
  beforeAll(async () => {
    // Setup test database
    await prisma.$connect();
  });

  afterAll(async () => {
    // Clean up test database
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear users before each test
    await prisma.user.deleteMany({});
  });

  describe('POST /api/auth/register', () => {
    const validUserData = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123'
    };

    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(validUserData)
        .expect(201);

      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.user.email).toBe(validUserData.email);
      expect(response.body.user.name).toBe(validUserData.name);
      expect(response.body.user).not.toHaveProperty('password');

      // Verify user was created in database
      const user = await prisma.user.findUnique({
        where: { email: validUserData.email }
      });
      expect(user).toBeTruthy();
      expect(user?.email).toBe(validUserData.email);
    });

    it('should return 400 for invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          ...validUserData,
          email: 'invalid-email'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid email format');
    });

    it('should return 400 for short password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          ...validUserData,
          password: '123'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Password must be at least 6 characters');
    });

    it('should return 409 for duplicate email', async () => {
      // First registration
      await request(app)
        .post('/api/auth/register')
        .send(validUserData)
        .expect(201);

      // Second registration with same email
      const response = await request(app)
        .post('/api/auth/register')
        .send(validUserData)
        .expect(409);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Email already exists');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com'
          // missing name and password
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });
  });

  describe('POST /api/auth/login', () => {
    const userData = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123'
    };

    beforeEach(async () => {
      // Create a user for login tests
      await request(app)
        .post('/api/auth/register')
        .send(userData);
    });

    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: userData.email,
          password: userData.password
        })
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body.user).not.toHaveProperty('password');
    });

    it('should return 401 for invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: userData.password
        })
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid credentials');
    });

    it('should return 401 for invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: userData.email,
          password: 'wrongpassword'
        })
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid credentials');
    });

    it('should return 400 for missing fields', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: userData.email
          // missing password
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 429 for too many login attempts', async () => {
      // Simulate multiple failed login attempts
      const promises = Array(6).fill(null).map(() =>
        request(app)
          .post('/api/auth/login')
          .send({
            email: userData.email,
            password: 'wrongpassword'
          })
      );

      await Promise.all(promises);

      // Next attempt should be rate limited
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: userData.email,
          password: userData.password
        })
        .expect(429);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Too many login attempts');
    });
  });

  describe('GET /api/auth/me', () => {
    let authToken: string;
    let userId: string;

    beforeEach(async () => {
      // Register and login to get auth token
      const userData = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      };

      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send(userData);

      authToken = registerResponse.body.token;
      userId = registerResponse.body.user.id;
    });

    it('should return current user data', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', userId);
      expect(response.body).toHaveProperty('email', 'test@example.com');
      expect(response.body).toHaveProperty('name', 'Test User');
      expect(response.body).not.toHaveProperty('password');
    });

    it('should return 401 without auth token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Unauthorized');
    });

    it('should return 401 with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid token');
    });

    it('should return 401 with expired token', async () => {
      // Mock an expired token scenario
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid';
      
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });
  });

  describe('POST /api/auth/refresh', () => {
    let refreshToken: string;
    let authToken: string;

    beforeEach(async () => {
      const userData = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData);

      authToken = response.body.token;
      refreshToken = response.body.refreshToken;
    });

    it('should refresh token successfully', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.token).not.toBe(authToken);
      expect(response.body.refreshToken).not.toBe(refreshToken);
    });

    it('should return 400 for missing refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Refresh token is required');
    });

    it('should return 401 for invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-refresh-token' })
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid refresh token');
    });
  });

  describe('POST /api/auth/logout', () => {
    let authToken: string;
    let refreshToken: string;

    beforeEach(async () => {
      const userData = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData);

      authToken = response.body.token;
      refreshToken = response.body.refreshToken;
    });

    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Logged out successfully');

      // Token should no longer be valid
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(401);
    });

    it('should logout without refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 401 without auth token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    beforeEach(async () => {
      // Create a user for password reset tests
      await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123'
        });
    });

    it('should send password reset email', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Password reset email sent');
    });

    it('should return 200 for non-existent email (security)', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' })
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Password reset email sent');
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'invalid-email' })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });
  });
});