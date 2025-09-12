import { PrismaClient } from '@prisma/client';
import { seedData, testUsers, testCourses, testLessons } from './test-data';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/learning_platform_test'
    }
  }
});

export async function setupTestDatabase() {
  try {
    // Clean existing data
    await cleanupTestDatabase();

    // Create users
    await prisma.user.createMany({
      data: seedData.users
    });

    // Create categories
    await prisma.category.createMany({
      data: seedData.categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug
      }))
    });

    // Create courses
    for (const course of seedData.courses) {
      await prisma.course.create({
        data: {
          id: course.id,
          title: course.title,
          description: course.description,
          price: course.price,
          discountedPrice: course.discountedPrice,
          level: course.level,
          duration: course.duration,
          rating: course.rating,
          studentCount: course.studentCount,
          instructorId: course.instructorId,
          thumbnail: course.thumbnail,
          featured: course.featured,
          published: course.published,
          prerequisites: course.prerequisites,
          learningObjectives: course.learningObjectives,
          createdAt: new Date(course.createdAt),
          updatedAt: new Date(course.updatedAt),
          // Create course-category relationships
          categories: {
            connect: course.tags.map(tag => {
              const category = seedData.categories.find(cat => 
                cat.name.toLowerCase().includes(tag.toLowerCase())
              );
              return category ? { id: category.id } : { id: '1' }; // Default to first category
            }).filter(Boolean)
          }
        }
      });
    }

    // Create lessons
    for (const lesson of seedData.lessons) {
      await prisma.lesson.create({
        data: {
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          content: lesson.content,
          type: lesson.type,
          duration: lesson.duration,
          order: lesson.order,
          courseId: lesson.courseId,
          videoUrl: lesson.videoUrl,
          resources: lesson.resources || [],
          createdAt: new Date(lesson.createdAt),
          updatedAt: new Date(lesson.updatedAt)
        }
      });

      // Create quiz if exists
      if (lesson.quiz) {
        await prisma.quiz.create({
          data: {
            id: lesson.quiz.id,
            lessonId: lesson.id,
            questions: lesson.quiz.questions
          }
        });
      }
    }

    // Create enrollments
    await prisma.enrollment.createMany({
      data: seedData.enrollments.map(enrollment => ({
        ...enrollment,
        enrolledAt: new Date(enrollment.enrolledAt),
        completedAt: enrollment.completedAt ? new Date(enrollment.completedAt) : null,
        lastAccessedAt: enrollment.lastAccessedAt ? new Date(enrollment.lastAccessedAt) : null
      }))
    });

    // Create progress records
    await prisma.progress.createMany({
      data: seedData.progress.map(progress => ({
        ...progress,
        completedAt: progress.completedAt ? new Date(progress.completedAt) : null
      }))
    });

    // Create reviews
    await prisma.review.createMany({
      data: seedData.reviews.map(review => ({
        id: review.id,
        userId: review.userId,
        courseId: review.courseId,
        rating: review.rating,
        comment: review.comment,
        createdAt: new Date(review.createdAt),
        updatedAt: new Date(review.updatedAt)
      }))
    });

    // Create achievements
    await prisma.achievement.createMany({
      data: seedData.achievements
    });

    // Create notifications
    await prisma.notification.createMany({
      data: seedData.notifications.map(notification => ({
        ...notification,
        createdAt: new Date(notification.createdAt)
      }))
    });

    // Create certificates
    await prisma.certificate.createMany({
      data: seedData.certificates.map(certificate => ({
        ...certificate,
        issuedAt: new Date(certificate.issuedAt)
      }))
    });

    console.log('✅ Test database setup completed');
    return prisma;
  } catch (error) {
    console.error('❌ Test database setup failed:', error);
    throw error;
  }
}

export async function cleanupTestDatabase() {
  try {
    // Delete in correct order to avoid foreign key constraints
    await prisma.$transaction([
      prisma.certificate.deleteMany({}),
      prisma.notification.deleteMany({}),
      prisma.userAchievement.deleteMany({}),
      prisma.achievement.deleteMany({}),
      prisma.review.deleteMany({}),
      prisma.progress.deleteMany({}),
      prisma.enrollment.deleteMany({}),
      prisma.quiz.deleteMany({}),
      prisma.lesson.deleteMany({}),
      prisma.courseCategory.deleteMany({}),
      prisma.course.deleteMany({}),
      prisma.category.deleteMany({}),
      prisma.user.deleteMany({})
    ]);

    console.log('🧹 Test database cleaned');
  } catch (error) {
    console.error('❌ Test database cleanup failed:', error);
    throw error;
  }
}

export async function resetTestDatabase() {
  await cleanupTestDatabase();
  await setupTestDatabase();
  return prisma;
}

// Helper functions for specific test scenarios
export async function createTestUser(userData: Partial<typeof testUsers.student> = {}) {
  const user = {
    ...testUsers.student,
    id: Math.random().toString(36).substr(2, 9),
    email: `user${Date.now()}@example.com`,
    ...userData
  };

  return await prisma.user.create({ data: user });
}

export async function createTestCourse(courseData: Partial<typeof testCourses.javascript> = {}) {
  const course = {
    ...testCourses.javascript,
    id: Math.random().toString(36).substr(2, 9),
    title: `Course ${Date.now()}`,
    ...courseData
  };

  return await prisma.course.create({ data: course });
}

export async function createTestLesson(
  courseId: string,
  lessonData: Partial<typeof testLessons.jsIntro> = {}
) {
  const lesson = {
    ...testLessons.jsIntro,
    id: Math.random().toString(36).substr(2, 9),
    title: `Lesson ${Date.now()}`,
    courseId,
    ...lessonData
  };

  return await prisma.lesson.create({ data: lesson });
}

export async function enrollUserInCourse(userId: string, courseId: string) {
  return await prisma.enrollment.create({
    data: {
      userId,
      courseId,
      enrolledAt: new Date(),
      progress: 0
    }
  });
}

export async function createTestProgress(
  userId: string,
  lessonId: string,
  completed = false,
  score?: number
) {
  return await prisma.progress.create({
    data: {
      userId,
      lessonId,
      completed,
      completedAt: completed ? new Date() : null,
      timeSpent: Math.floor(Math.random() * 1800) + 300, // 5-35 minutes
      score: score || (completed ? Math.floor(Math.random() * 40) + 60 : null) // 60-100 if completed
    }
  });
}

export async function createTestReview(
  userId: string,
  courseId: string,
  rating: number,
  comment: string
) {
  return await prisma.review.create({
    data: {
      userId,
      courseId,
      rating,
      comment,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  });
}

// Transaction helpers for complex test scenarios
export async function createCompleteTestScenario() {
  return await prisma.$transaction(async (tx) => {
    // Create instructor
    const instructor = await tx.user.create({
      data: {
        ...testUsers.instructor,
        id: 'test-instructor-1'
      }
    });

    // Create student
    const student = await tx.user.create({
      data: {
        ...testUsers.student,
        id: 'test-student-1'
      }
    });

    // Create course
    const course = await tx.course.create({
      data: {
        ...testCourses.javascript,
        id: 'test-course-1',
        instructorId: instructor.id
      }
    });

    // Create lessons
    const lessons = await Promise.all([
      tx.lesson.create({
        data: {
          ...testLessons.jsIntro,
          id: 'test-lesson-1',
          courseId: course.id
        }
      }),
      tx.lesson.create({
        data: {
          ...testLessons.jsVariables,
          id: 'test-lesson-2',
          courseId: course.id
        }
      })
    ]);

    // Enroll student
    const enrollment = await tx.enrollment.create({
      data: {
        userId: student.id,
        courseId: course.id,
        enrolledAt: new Date(),
        progress: 50
      }
    });

    // Create progress for first lesson
    await tx.progress.create({
      data: {
        userId: student.id,
        lessonId: lessons[0].id,
        completed: true,
        completedAt: new Date(),
        timeSpent: 900,
        score: 95
      }
    });

    return {
      instructor,
      student,
      course,
      lessons,
      enrollment
    };
  });
}

export { prisma };
export default prisma;