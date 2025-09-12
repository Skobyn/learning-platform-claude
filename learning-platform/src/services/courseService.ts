// Course Management Service
// Implements course creation, management, and enrollment following the pseudocode

export interface Course {
  id: string
  title: string
  description: string
  objectives: string[]
  createdBy: string
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  category: string
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
  estimatedDuration: number // in minutes
  modules: Module[]
  tags: string[]
  price: number
  currency: string
  thumbnailUrl?: string
  createdAt: Date
  updatedAt: Date
  publishedAt?: Date
  enrollmentCount: number
  averageRating: number
  isAIGenerated: boolean
}

export interface Module {
  id: string
  courseId: string
  title: string
  description: string
  objectives: string[]
  orderIndex: number
  lessons: Lesson[]
  quiz?: Quiz
  estimatedDuration: number
  prerequisites: string[]
  createdAt: Date
  updatedAt: Date
}

export interface Lesson {
  id: string
  moduleId: string
  title: string
  content: string
  contentType: 'TEXT' | 'VIDEO' | 'INTERACTIVE' | 'DOCUMENT'
  orderIndex: number
  keyPoints: string[]
  resources: Resource[]
  estimatedDuration: number
  videoUrl?: string
  attachments: string[]
  createdAt: Date
  updatedAt: Date
}

export interface Quiz {
  id: string
  moduleId: string
  title: string
  description: string
  questions: Question[]
  passingScore: number
  timeLimit?: number // in minutes
  maxAttempts: number
  showResultsImmediately: boolean
  allowReview: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Question {
  id: string
  quizId: string
  text: string
  type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'FILL_BLANK' | 'ESSAY'
  options?: string[]
  correctAnswer: string | string[]
  explanation: string
  points: number
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  orderIndex: number
}

export interface Resource {
  id: string
  title: string
  type: 'LINK' | 'DOCUMENT' | 'VIDEO' | 'BOOK'
  url: string
  description: string
}

export interface Enrollment {
  id: string
  userId: string
  courseId: string
  enrolledAt: Date
  status: 'ACTIVE' | 'COMPLETED' | 'SUSPENDED' | 'WITHDRAWN'
  progress: number
  completedAt?: Date
  lastAccessedAt?: Date
  certificateIssued: boolean
}

export interface Progress {
  id: string
  userId: string
  lessonId: string
  moduleId: string
  courseId: string
  startedAt?: Date
  completedAt?: Date
  lastAccessedAt: Date
  completionPercentage: number
  timeSpent: number // in minutes
  notes?: string
}

class CourseService {
  // Mock database - replace with actual database calls
  private courses: Course[] = []
  private modules: Module[] = []
  private lessons: Lesson[] = []
  private quizzes: Quiz[] = []
  private enrollments: Enrollment[] = []
  private progress: Progress[] = []
  
  async createCourse(courseData: Omit<Course, 'id' | 'createdAt' | 'updatedAt' | 'enrollmentCount' | 'averageRating'>, creatorId: string): Promise<Course> {
    const course: Course = {
      ...courseData,
      id: Math.random().toString(36).substr(2, 9),
      createdBy: creatorId,
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
      enrollmentCount: 0,
      averageRating: 0,
      modules: []
    }
    
    // If AI enhancement is requested
    if (courseData.isAIGenerated) {
      // In real implementation, call AI service
      course.description = await this.enhanceCourseWithAI(course)
    }
    
    this.courses.push(course)
    
    // Create modules if provided
    if (courseData.modules && courseData.modules.length > 0) {
      for (const moduleData of courseData.modules) {
        await this.createModule(moduleData, course.id)
      }
    }
    
    return course
  }
  
  async createModule(moduleData: Omit<Module, 'id' | 'createdAt' | 'updatedAt'>, courseId: string): Promise<Module> {
    const module: Module = {
      ...moduleData,
      id: Math.random().toString(36).substr(2, 9),
      courseId,
      createdAt: new Date(),
      updatedAt: new Date(),
      lessons: []
    }
    
    this.modules.push(module)
    
    // Create lessons if provided
    if (moduleData.lessons && moduleData.lessons.length > 0) {
      for (const lessonData of moduleData.lessons) {
        await this.createLesson(lessonData, module.id)
      }
    }
    
    // Create quiz if provided
    if (moduleData.quiz) {
      await this.createQuiz(moduleData.quiz, module.id)
    }
    
    // Update course modules array
    const course = this.courses.find(c => c.id === courseId)
    if (course) {
      course.modules.push(module)
    }
    
    return module
  }
  
  async createLesson(lessonData: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'>, moduleId: string): Promise<Lesson> {
    const lesson: Lesson = {
      ...lessonData,
      id: Math.random().toString(36).substr(2, 9),
      moduleId,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    
    this.lessons.push(lesson)
    
    // Update module lessons array
    const module = this.modules.find(m => m.id === moduleId)
    if (module) {
      module.lessons.push(lesson)
    }
    
    return lesson
  }
  
  async createQuiz(quizData: Omit<Quiz, 'id' | 'createdAt' | 'updatedAt'>, moduleId: string): Promise<Quiz> {
    const quiz: Quiz = {
      ...quizData,
      id: Math.random().toString(36).substr(2, 9),
      moduleId,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    
    this.quizzes.push(quiz)
    
    // Update module quiz reference
    const module = this.modules.find(m => m.id === moduleId)
    if (module) {
      module.quiz = quiz
    }
    
    return quiz
  }
  
  async enrollUser(userId: string, courseId: string): Promise<Enrollment> {
    // Check if already enrolled
    const existingEnrollment = this.enrollments.find(
      e => e.userId === userId && e.courseId === courseId
    )
    
    if (existingEnrollment) {
      throw new Error('User already enrolled in this course')
    }
    
    const enrollment: Enrollment = {
      id: Math.random().toString(36).substr(2, 9),
      userId,
      courseId,
      enrolledAt: new Date(),
      status: 'ACTIVE',
      progress: 0,
      certificateIssued: false
    }
    
    this.enrollments.push(enrollment)
    
    // Initialize progress tracking
    await this.initializeProgress(userId, courseId)
    
    // Send enrollment confirmation (mock)
    await this.sendEnrollmentConfirmation(userId, courseId)
    
    // Update course enrollment count
    const course = this.courses.find(c => c.id === courseId)
    if (course) {
      course.enrollmentCount += 1
    }
    
    return enrollment
  }
  
  async trackProgress(userId: string, lessonId: string): Promise<Progress> {
    const lesson = this.lessons.find(l => l.id === lessonId)
    if (!lesson) {
      throw new Error('Lesson not found')
    }
    
    const module = this.modules.find(m => m.id === lesson.moduleId)
    if (!module) {
      throw new Error('Module not found')
    }
    
    let progress = this.progress.find(
      p => p.userId === userId && p.lessonId === lessonId
    )
    
    if (!progress) {
      progress = {
        id: Math.random().toString(36).substr(2, 9),
        userId,
        lessonId,
        moduleId: lesson.moduleId,
        courseId: module.courseId,
        lastAccessedAt: new Date(),
        completionPercentage: 0,
        timeSpent: 0
      }
      this.progress.push(progress)
    }
    
    // Update progress
    if (!progress.startedAt) {
      progress.startedAt = new Date()
    }
    progress.lastAccessedAt = new Date()
    progress.completionPercentage = this.calculateCompletion(progress)
    
    if (progress.completionPercentage >= 100 && !progress.completedAt) {
      progress.completedAt = new Date()
      await this.checkModuleCompletion(userId, lesson.moduleId)
    }
    
    return progress
  }
  
  async getCourse(courseId: string): Promise<Course | null> {
    return this.courses.find(c => c.id === courseId) || null
  }
  
  async getCourses(filters?: {
    category?: string
    difficulty?: string
    status?: string
    createdBy?: string
    limit?: number
    offset?: number
  }): Promise<{ courses: Course[], total: number }> {
    let filteredCourses = [...this.courses]
    
    if (filters?.category) {
      filteredCourses = filteredCourses.filter(c => c.category === filters.category)
    }
    
    if (filters?.difficulty) {
      filteredCourses = filteredCourses.filter(c => c.difficulty === filters.difficulty)
    }
    
    if (filters?.status) {
      filteredCourses = filteredCourses.filter(c => c.status === filters.status)
    }
    
    if (filters?.createdBy) {
      filteredCourses = filteredCourses.filter(c => c.createdBy === filters.createdBy)
    }
    
    const total = filteredCourses.length
    
    if (filters?.offset !== undefined) {
      filteredCourses = filteredCourses.slice(filters.offset)
    }
    
    if (filters?.limit !== undefined) {
      filteredCourses = filteredCourses.slice(0, filters.limit)
    }
    
    return { courses: filteredCourses, total }
  }
  
  async getUserEnrollments(userId: string): Promise<Enrollment[]> {
    return this.enrollments.filter(e => e.userId === userId)
  }
  
  async getCourseProgress(userId: string, courseId: string): Promise<{
    overall: number
    modules: { moduleId: string, progress: number }[]
    lessons: Progress[]
  }> {
    const courseProgress = this.progress.filter(
      p => p.userId === userId && p.courseId === courseId
    )
    
    const course = this.courses.find(c => c.id === courseId)
    if (!course) {
      throw new Error('Course not found')
    }
    
    // Calculate module progress
    const moduleProgress = course.modules.map(module => {
      const moduleLessons = this.lessons.filter(l => l.moduleId === module.id)
      const moduleProgressItems = courseProgress.filter(p => p.moduleId === module.id)
      
      const totalLessons = moduleLessons.length
      const completedLessons = moduleProgressItems.filter(p => p.completionPercentage >= 100).length
      
      return {
        moduleId: module.id,
        progress: totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0
      }
    })
    
    // Calculate overall progress
    const totalModules = course.modules.length
    const overallProgress = totalModules > 0 
      ? moduleProgress.reduce((sum, mp) => sum + mp.progress, 0) / totalModules 
      : 0
    
    return {
      overall: overallProgress,
      modules: moduleProgress,
      lessons: courseProgress
    }
  }
  
  async publishCourse(courseId: string): Promise<Course> {
    const course = this.courses.find(c => c.id === courseId)
    if (!course) {
      throw new Error('Course not found')
    }
    
    // Validate course is ready for publishing
    if (course.modules.length === 0) {
      throw new Error('Course must have at least one module to be published')
    }
    
    course.status = 'PUBLISHED'
    course.publishedAt = new Date()
    course.updatedAt = new Date()
    
    return course
  }
  
  private async enhanceCourseWithAI(course: Course): Promise<string> {
    // Mock AI enhancement - in real implementation, call AI service
    return `${course.description} [Enhanced with AI: This course includes personalized learning paths and adaptive content.]`
  }
  
  private async initializeProgress(userId: string, courseId: string): Promise<void> {
    const course = this.courses.find(c => c.id === courseId)
    if (!course) return
    
    // Initialize progress for all lessons in the course
    for (const module of course.modules) {
      for (const lesson of module.lessons) {
        const progressExists = this.progress.find(
          p => p.userId === userId && p.lessonId === lesson.id
        )
        
        if (!progressExists) {
          this.progress.push({
            id: Math.random().toString(36).substr(2, 9),
            userId,
            lessonId: lesson.id,
            moduleId: module.id,
            courseId,
            lastAccessedAt: new Date(),
            completionPercentage: 0,
            timeSpent: 0
          })
        }
      }
    }
  }
  
  private calculateCompletion(progress: Progress): number {
    // Mock completion calculation - in real implementation, 
    // this would track actual lesson interaction and content consumption
    return Math.min(100, progress.timeSpent / 10 * 100) // 10 minutes = 100%
  }
  
  private async checkModuleCompletion(userId: string, moduleId: string): Promise<void> {
    const module = this.modules.find(m => m.id === moduleId)
    if (!module) return
    
    const moduleLessons = module.lessons
    const moduleProgress = this.progress.filter(
      p => p.userId === userId && p.moduleId === moduleId
    )
    
    const completedLessons = moduleProgress.filter(p => p.completionPercentage >= 100)
    
    if (completedLessons.length === moduleLessons.length) {
      // Module completed - check if course is completed
      await this.checkCourseCompletion(userId, module.courseId)
    }
  }
  
  private async checkCourseCompletion(userId: string, courseId: string): Promise<void> {
    const course = this.courses.find(c => c.id === courseId)
    if (!course) return
    
    const courseProgress = await this.getCourseProgress(userId, courseId)
    
    if (courseProgress.overall >= 100) {
      // Mark enrollment as completed
      const enrollment = this.enrollments.find(
        e => e.userId === userId && e.courseId === courseId
      )
      
      if (enrollment && enrollment.status === 'ACTIVE') {
        enrollment.status = 'COMPLETED'
        enrollment.completedAt = new Date()
        enrollment.progress = 100
      }
    }
  }
  
  private async sendEnrollmentConfirmation(userId: string, courseId: string): Promise<void> {
    // Mock notification - in real implementation, send email/notification
    console.log(`Enrollment confirmation sent to user ${userId} for course ${courseId}`)
  }
}

// Export singleton instance
export const courseService = new CourseService()