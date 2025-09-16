# Learning Platform API Documentation

## Overview

The Learning Platform provides a comprehensive RESTful API for managing courses, users, enrollments, assessments, and more. Built with Next.js App Router and TypeScript.

## Base URL
```
Production: https://your-app.run.app
Development: http://localhost:3000
```

## Authentication

All protected endpoints require authentication via session cookies or JWT tokens.

### Headers
```
Content-Type: application/json
Authorization: Bearer <token> (if using JWT)
```

## API Endpoints

### Authentication

#### POST /api/auth/login
Login user with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user123",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "learner"
    },
    "token": "jwt_token_here"
  }
}
```

#### POST /api/auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe",
  "role": "learner"
}
```

#### POST /api/auth/logout
Logout current user and invalidate session.

#### POST /api/auth/forgot-password
Request password reset email.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

#### POST /api/auth/reset-password
Reset user password with token.

**Request Body:**
```json
{
  "token": "reset_token",
  "newPassword": "newpassword123"
}
```

#### POST /api/auth/verify-email
Verify user email address.

**Request Body:**
```json
{
  "token": "verification_token"
}
```

### Users

#### GET /api/users/profile
Get current user profile.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "user123",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "learner",
    "department": "Engineering",
    "profileImage": "https://example.com/avatar.jpg",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### GET /api/users/stats
Get user learning statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "coursesCompleted": 15,
    "coursesInProgress": 3,
    "totalLearningTime": 2400,
    "badgesEarned": 8,
    "certificates": 5,
    "streak": 7
  }
}
```

### Admin Users

#### GET /api/admin/users
List all users (admin only).

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 10)
- `role`: Filter by user role
- `department`: Filter by department

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "user123",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "learner",
      "department": "Engineering",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10
  }
}
```

### Courses

#### GET /api/courses
List available courses.

**Query Parameters:**
- `page`: Page number
- `limit`: Items per page
- `category`: Filter by category
- `level`: Filter by difficulty level
- `search`: Search term

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "course123",
      "title": "JavaScript Fundamentals",
      "description": "Learn the basics of JavaScript programming",
      "instructorId": "instructor123",
      "categoryId": "programming",
      "level": "beginner",
      "duration": 480,
      "thumbnailUrl": "https://example.com/thumb.jpg",
      "isPublished": true,
      "enrollmentCount": 150,
      "rating": 4.5
    }
  ]
}
```

#### GET /api/courses/[id]
Get detailed course information.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "course123",
    "title": "JavaScript Fundamentals",
    "description": "Comprehensive JavaScript course",
    "modules": [
      {
        "id": "module1",
        "title": "Variables and Data Types",
        "description": "Learn about JS variables",
        "order": 1,
        "duration": 60,
        "content": [
          {
            "id": "content1",
            "type": "video",
            "title": "Introduction to Variables",
            "videoUrl": "https://example.com/video1.mp4",
            "order": 1
          }
        ]
      }
    ],
    "instructor": {
      "id": "instructor123",
      "firstName": "Jane",
      "lastName": "Smith"
    }
  }
}
```

#### POST /api/courses/[id]/enroll
Enroll current user in course.

**Response:**
```json
{
  "success": true,
  "data": {
    "enrollmentId": "enrollment123",
    "courseId": "course123",
    "userId": "user123",
    "enrolledAt": "2024-01-01T00:00:00Z",
    "status": "active"
  }
}
```

### Quizzes

#### GET /api/quiz/[quizId]
Get quiz questions and details.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "quiz123",
    "title": "JavaScript Basics Quiz",
    "description": "Test your JavaScript knowledge",
    "timeLimit": 30,
    "passingScore": 70,
    "questions": [
      {
        "id": "q1",
        "type": "multiple_choice",
        "question": "What is the correct way to declare a variable?",
        "options": ["var x = 1", "variable x = 1", "v x = 1"],
        "points": 10,
        "order": 1
      }
    ]
  }
}
```

#### POST /api/quiz/[quizId]/submit
Submit quiz answers.

**Request Body:**
```json
{
  "answers": [
    {
      "questionId": "q1",
      "answer": "var x = 1"
    }
  ]
}
```

### Certificates

#### POST /api/certificates/generate
Generate completion certificate.

**Request Body:**
```json
{
  "courseId": "course123",
  "userId": "user123"
}
```

#### GET /api/certificates/verify/[code]
Verify certificate authenticity.

**Response:**
```json
{
  "success": true,
  "data": {
    "isValid": true,
    "certificate": {
      "id": "cert123",
      "courseName": "JavaScript Fundamentals",
      "userName": "John Doe",
      "issuedAt": "2024-01-01T00:00:00Z"
    }
  }
}
```

### File Upload

#### POST /api/upload
Upload media files.

**Request:** Multipart form data with file field.

**Response:**
```json
{
  "success": true,
  "data": {
    "fileId": "file123",
    "filename": "document.pdf",
    "url": "https://storage.googleapis.com/bucket/file123.pdf",
    "mimeType": "application/pdf",
    "size": 1024000
  }
}
```

### System Health

#### GET /api/health
Check system health status.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-01T00:00:00Z",
    "uptime": 3600,
    "database": "connected",
    "redis": "connected"
  }
}
```

#### GET /api/health/redis
Check Redis connection status.

### Cache Management

#### DELETE /api/cache
Clear application cache (admin only).

### Sessions

#### GET /api/sessions
Get user session information.

## Error Responses

All endpoints return error responses in this format:

```json
{
  "success": false,
  "error": "Error code or type",
  "message": "Human-readable error message"
}
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Rate Limited
- `500` - Internal Server Error

## Rate Limiting

API requests are rate-limited to prevent abuse:

- **Authenticated users**: 1000 requests per hour
- **Anonymous users**: 100 requests per hour
- **File uploads**: 50 requests per hour

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

## Data Types

### User Roles
- `admin` - Full system access
- `instructor` - Can create and manage courses
- `learner` - Can enroll and take courses
- `manager` - Can view team analytics

### Course Levels
- `beginner` - Entry level
- `intermediate` - Some experience required
- `advanced` - Expert level

### Enrollment Status
- `active` - Currently enrolled
- `completed` - Successfully finished
- `dropped` - Voluntarily left
- `suspended` - Temporarily disabled

## SDKs and Libraries

### JavaScript/TypeScript
```bash
npm install @learning-platform/api-client
```

### Usage Example
```typescript
import { LearningPlatformAPI } from '@learning-platform/api-client';

const api = new LearningPlatformAPI({
  baseURL: 'https://your-app.run.app',
  apiKey: 'your-api-key'
});

// Get user profile
const profile = await api.users.getProfile();

// Enroll in course
const enrollment = await api.courses.enroll('course123');
```

## WebSocket Events

Real-time events are available via WebSocket connection:

### Connection
```javascript
const ws = new WebSocket('wss://your-app.run.app/ws');
```

### Events
- `progress.updated` - Course progress changed
- `quiz.completed` - Quiz submission processed
- `badge.earned` - New badge awarded
- `notification.received` - New notification

## Changelog

### v1.0.0 (Current)
- Initial API release
- Core user management
- Course and enrollment system
- Quiz and assessment functionality
- Certificate generation
- File upload support

### Upcoming Features
- Advanced analytics API
- Mobile app endpoints
- Webhook support
- GraphQL endpoint
- Batch operations API

## Support

For API support and questions:
- Documentation: https://docs.learning-platform.com
- Support Email: api-support@learning-platform.com
- Status Page: https://status.learning-platform.com