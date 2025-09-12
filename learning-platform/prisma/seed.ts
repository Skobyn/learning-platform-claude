import { PrismaClient, Role, CourseLevel, AssessmentType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@learningplatform.com' },
    update: {},
    create: {
      email: 'admin@learningplatform.com',
      name: 'Platform Administrator',
      password: adminPassword,
      role: Role.ADMIN,
      verified: true,
    },
  });

  console.log('✅ Created admin user:', admin.email);

  // Create instructors
  const instructorPassword = await bcrypt.hash('instructor123', 12);
  const instructors = await Promise.all([
    prisma.user.upsert({
      where: { email: 'jane.smith@learningplatform.com' },
      update: {},
      create: {
        email: 'jane.smith@learningplatform.com',
        name: 'Jane Smith',
        password: instructorPassword,
        role: Role.INSTRUCTOR,
        verified: true,
        bio: 'Senior software engineer with 10+ years of experience in web development.',
        expertise: ['JavaScript', 'React', 'Node.js', 'TypeScript'],
      },
    }),
    prisma.user.upsert({
      where: { email: 'john.doe@learningplatform.com' },
      update: {},
      create: {
        email: 'john.doe@learningplatform.com',
        name: 'John Doe',
        password: instructorPassword,
        role: Role.INSTRUCTOR,
        verified: true,
        bio: 'Data science expert with PhD in Machine Learning.',
        expertise: ['Python', 'Machine Learning', 'Data Analysis', 'Statistics'],
      },
    }),
  ]);

  console.log('✅ Created instructors:', instructors.map(i => i.email));

  // Create students
  const studentPassword = await bcrypt.hash('student123', 12);
  const students = await Promise.all([
    prisma.user.upsert({
      where: { email: 'alice@example.com' },
      update: {},
      create: {
        email: 'alice@example.com',
        name: 'Alice Johnson',
        password: studentPassword,
        role: Role.STUDENT,
        verified: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'bob@example.com' },
      update: {},
      create: {
        email: 'bob@example.com',
        name: 'Bob Wilson',
        password: studentPassword,
        role: Role.STUDENT,
        verified: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'carol@example.com' },
      update: {},
      create: {
        email: 'carol@example.com',
        name: 'Carol Davis',
        password: studentPassword,
        role: Role.STUDENT,
        verified: true,
      },
    }),
  ]);

  console.log('✅ Created students:', students.map(s => s.email));

  // Create categories
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { name: 'Web Development' },
      update: {},
      create: {
        name: 'Web Development',
        description: 'Learn modern web development technologies and frameworks',
        slug: 'web-development',
      },
    }),
    prisma.category.upsert({
      where: { name: 'Data Science' },
      update: {},
      create: {
        name: 'Data Science',
        description: 'Master data analysis, machine learning, and statistics',
        slug: 'data-science',
      },
    }),
    prisma.category.upsert({
      where: { name: 'Mobile Development' },
      update: {},
      create: {
        name: 'Mobile Development',
        description: 'Build native and cross-platform mobile applications',
        slug: 'mobile-development',
      },
    }),
  ]);

  console.log('✅ Created categories:', categories.map(c => c.name));

  // Create courses
  const courses = await Promise.all([
    prisma.course.create({
      data: {
        title: 'Complete React Development Course',
        description: 'Master React from basics to advanced concepts including hooks, context, and testing.',
        slug: 'complete-react-development',
        level: CourseLevel.INTERMEDIATE,
        price: 99.99,
        duration: 480, // 8 hours
        published: true,
        thumbnail: 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=400',
        instructorId: instructors[0].id,
        categoryId: categories[0].id,
        tags: ['React', 'JavaScript', 'Frontend', 'Hooks'],
        requirements: ['Basic JavaScript knowledge', 'HTML/CSS fundamentals'],
        learningOutcomes: [
          'Build modern React applications',
          'Understand React hooks and state management',
          'Implement routing with React Router',
          'Write unit tests for React components'
        ],
      },
    }),
    prisma.course.create({
      data: {
        title: 'Python for Data Science',
        description: 'Learn Python programming for data analysis, visualization, and machine learning.',
        slug: 'python-data-science',
        level: CourseLevel.BEGINNER,
        price: 79.99,
        duration: 600, // 10 hours
        published: true,
        thumbnail: 'https://images.unsplash.com/photo-1526379879527-8559ecfcaec0?w=400',
        instructorId: instructors[1].id,
        categoryId: categories[1].id,
        tags: ['Python', 'Data Science', 'Pandas', 'NumPy'],
        requirements: ['No programming experience required'],
        learningOutcomes: [
          'Master Python fundamentals',
          'Analyze data with Pandas and NumPy',
          'Create visualizations with Matplotlib',
          'Build basic machine learning models'
        ],
      },
    }),
    prisma.course.create({
      data: {
        title: 'Advanced TypeScript Patterns',
        description: 'Deep dive into advanced TypeScript features and design patterns.',
        slug: 'advanced-typescript-patterns',
        level: CourseLevel.ADVANCED,
        price: 129.99,
        duration: 360, // 6 hours
        published: true,
        thumbnail: 'https://images.unsplash.com/photo-1587620962725-abab7fe55159?w=400',
        instructorId: instructors[0].id,
        categoryId: categories[0].id,
        tags: ['TypeScript', 'Advanced', 'Patterns', 'Architecture'],
        requirements: ['Solid TypeScript knowledge', 'Experience with JavaScript'],
        learningOutcomes: [
          'Master advanced TypeScript features',
          'Implement complex type patterns',
          'Design type-safe architectures',
          'Optimize TypeScript performance'
        ],
      },
    }),
  ]);

  console.log('✅ Created courses:', courses.map(c => c.title));

  // Create modules and lessons for React course
  const reactCourse = courses[0];
  const reactModules = await Promise.all([
    prisma.module.create({
      data: {
        title: 'Getting Started with React',
        description: 'Introduction to React and setting up your development environment',
        orderIndex: 1,
        courseId: reactCourse.id,
        lessons: {
          create: [
            {
              title: 'What is React?',
              content: 'Introduction to React library and its core concepts...',
              videoUrl: 'https://example.com/videos/react-intro.mp4',
              duration: 15,
              orderIndex: 1,
            },
            {
              title: 'Setting up the Development Environment',
              content: 'Learn how to set up React development environment...',
              videoUrl: 'https://example.com/videos/react-setup.mp4',
              duration: 20,
              orderIndex: 2,
            },
            {
              title: 'Your First React Component',
              content: 'Create and understand React components...',
              videoUrl: 'https://example.com/videos/first-component.mp4',
              duration: 25,
              orderIndex: 3,
            },
          ],
        },
      },
    }),
    prisma.module.create({
      data: {
        title: 'React Hooks Deep Dive',
        description: 'Master React hooks including useState, useEffect, and custom hooks',
        orderIndex: 2,
        courseId: reactCourse.id,
        lessons: {
          create: [
            {
              title: 'Understanding useState',
              content: 'Learn how to manage state in functional components...',
              videoUrl: 'https://example.com/videos/usestate.mp4',
              duration: 30,
              orderIndex: 1,
            },
            {
              title: 'useEffect and Side Effects',
              content: 'Handle side effects in React components...',
              videoUrl: 'https://example.com/videos/useeffect.mp4',
              duration: 35,
              orderIndex: 2,
            },
          ],
        },
      },
    }),
  ]);

  console.log('✅ Created modules and lessons for React course');

  // Create assessments
  const assessments = await Promise.all([
    prisma.assessment.create({
      data: {
        title: 'React Fundamentals Quiz',
        description: 'Test your knowledge of React basics',
        type: AssessmentType.QUIZ,
        courseId: reactCourse.id,
        timeLimit: 30,
        passingScore: 70,
        questions: {
          create: [
            {
              question: 'What is JSX?',
              type: 'MULTIPLE_CHOICE',
              orderIndex: 1,
              options: [
                'A JavaScript extension',
                'A CSS framework',
                'A database query language',
                'A testing library'
              ],
              correctAnswer: ['A JavaScript extension'],
              points: 10,
            },
            {
              question: 'Which hook is used for state management?',
              type: 'MULTIPLE_CHOICE',
              orderIndex: 2,
              options: [
                'useEffect',
                'useState',
                'useContext',
                'useReducer'
              ],
              correctAnswer: ['useState'],
              points: 10,
            },
          ],
        },
      },
    }),
  ]);

  console.log('✅ Created assessments');

  // Create enrollments
  const enrollments = await Promise.all([
    prisma.enrollment.create({
      data: {
        userId: students[0].id,
        courseId: courses[0].id,
        progress: 25,
        completedAt: null,
      },
    }),
    prisma.enrollment.create({
      data: {
        userId: students[1].id,
        courseId: courses[0].id,
        progress: 60,
        completedAt: null,
      },
    }),
    prisma.enrollment.create({
      data: {
        userId: students[0].id,
        courseId: courses[1].id,
        progress: 100,
        completedAt: new Date(),
      },
    }),
  ]);

  console.log('✅ Created enrollments');

  // Create some lesson progress
  const firstModule = reactModules[0];
  const moduleWithLessons = await prisma.module.findUnique({
    where: { id: firstModule.id },
    include: { lessons: true },
  });

  if (moduleWithLessons && moduleWithLessons.lessons.length > 0) {
    await Promise.all([
      prisma.lessonProgress.create({
        data: {
          userId: students[0].id,
          lessonId: moduleWithLessons.lessons[0].id,
          completed: true,
          completedAt: new Date(),
        },
      }),
      prisma.lessonProgress.create({
        data: {
          userId: students[1].id,
          lessonId: moduleWithLessons.lessons[0].id,
          completed: true,
          completedAt: new Date(),
        },
      }),
      prisma.lessonProgress.create({
        data: {
          userId: students[1].id,
          lessonId: moduleWithLessons.lessons[1].id,
          completed: true,
          completedAt: new Date(),
        },
      }),
    ]);

    console.log('✅ Created lesson progress records');
  }

  // Create reviews
  const reviews = await Promise.all([
    prisma.review.create({
      data: {
        userId: students[0].id,
        courseId: courses[1].id, // Python course
        rating: 5,
        comment: 'Excellent course! Very comprehensive and well-structured.',
      },
    }),
    prisma.review.create({
      data: {
        userId: students[1].id,
        courseId: courses[0].id, // React course
        rating: 4,
        comment: 'Great content, but could use more practical examples.',
      },
    }),
  ]);

  console.log('✅ Created reviews');

  // Create forums and discussions
  const forums = await Promise.all([
    prisma.forum.create({
      data: {
        title: 'General Discussion',
        description: 'General discussions about the learning platform',
        courseId: null, // Global forum
      },
    }),
    prisma.forum.create({
      data: {
        title: 'React Course Discussion',
        description: 'Questions and discussions about the React course',
        courseId: courses[0].id,
      },
    }),
  ]);

  const discussions = await Promise.all([
    prisma.discussion.create({
      data: {
        title: 'Welcome to the Learning Platform!',
        content: 'Welcome everyone! Feel free to introduce yourself here.',
        authorId: admin.id,
        forumId: forums[0].id,
      },
    }),
    prisma.discussion.create({
      data: {
        title: 'Help with React Hooks',
        content: 'I am having trouble understanding useEffect. Can someone help?',
        authorId: students[0].id,
        forumId: forums[1].id,
      },
    }),
  ]);

  // Add replies to discussions
  await prisma.reply.create({
    data: {
      content: 'useEffect is used for side effects. Think of it as componentDidMount and componentDidUpdate combined.',
      authorId: instructors[0].id,
      discussionId: discussions[1].id,
    },
  });

  console.log('✅ Created forums and discussions');

  console.log('🎉 Database seeding completed successfully!');
  console.log('\n📋 Seeded data summary:');
  console.log('- 1 Admin user');
  console.log('- 2 Instructor users');
  console.log('- 3 Student users');
  console.log('- 3 Categories');
  console.log('- 3 Courses');
  console.log('- 2 Modules with lessons');
  console.log('- 1 Assessment with questions');
  console.log('- 3 Enrollments');
  console.log('- 2 Reviews');
  console.log('- 2 Forums with discussions');
  console.log('\n🔐 Login credentials:');
  console.log('Admin: admin@learningplatform.com / admin123');
  console.log('Instructor: jane.smith@learningplatform.com / instructor123');
  console.log('Student: alice@example.com / student123');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });