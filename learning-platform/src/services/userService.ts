import { User } from './authService'

// Extended user interface for user management
export interface UserProfile extends Omit<User, 'hashedPassword'> {
  profilePicture?: string
  bio?: string
  skills: string[]
  achievements: Achievement[]
  enrollments: Enrollment[]
  preferences: UserPreferences
  lastLogin?: Date
  isActive: boolean
}

export interface Achievement {
  id: string
  type: 'BADGE' | 'CERTIFICATE' | 'MILESTONE'
  title: string
  description: string
  earnedAt: Date
  courseId?: string
  level: 'BRONZE' | 'SILVER' | 'GOLD'
  verificationCode?: string
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
}

export interface UserPreferences {
  language: string
  timezone: string
  notifications: {
    email: boolean
    push: boolean
    inApp: boolean
    courseUpdates: boolean
    assessmentReminders: boolean
    achievementAlerts: boolean
  }
  learningStyle: 'VISUAL' | 'AUDITORY' | 'KINESTHETIC' | 'READING_WRITING'
  difficultyPreference: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
}

export interface UserStats {
  totalCourses: number
  completedCourses: number
  inProgressCourses: number
  totalBadges: number
  totalCertificates: number
  averageScore: number
  totalTimeSpent: number // in minutes
  streak: number // consecutive learning days
  lastActive: Date
}

class UserService {
  // Mock database - replace with actual database calls
  private userProfiles: Map<string, UserProfile> = new Map()
  private enrollments: Enrollment[] = []
  private achievements: Achievement[] = []
  
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      // In real implementation, this would query the database
      const profile = this.userProfiles.get(userId)
      
      if (!profile) {
        // Create default profile if doesn't exist
        const defaultProfile = await this.createDefaultProfile(userId)
        return defaultProfile
      }
      
      return profile
    } catch (error) {
      console.error('Error fetching user profile:', error)
      return null
    }
  }
  
  async updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<UserProfile | null> {
    try {
      const existingProfile = await this.getUserProfile(userId)
      
      if (!existingProfile) {
        throw new Error('User profile not found')
      }
      
      const updatedProfile: UserProfile = {
        ...existingProfile,
        ...updates,
        id: userId, // Ensure ID doesn't change
        updatedAt: new Date()
      }
      
      this.userProfiles.set(userId, updatedProfile)
      
      return updatedProfile
    } catch (error) {
      console.error('Error updating user profile:', error)
      return null
    }
  }
  
  async getUserStats(userId: string): Promise<UserStats | null> {
    try {
      const userEnrollments = this.enrollments.filter(e => e.userId === userId)
      const userAchievements = this.achievements.filter(a => a.id === userId)
      
      const completedCourses = userEnrollments.filter(e => e.status === 'COMPLETED').length
      const inProgressCourses = userEnrollments.filter(e => e.status === 'ACTIVE').length
      
      // Calculate average score (mock calculation)
      const averageScore = this.calculateAverageScore(userId)
      
      // Calculate total time spent (mock calculation)
      const totalTimeSpent = this.calculateTotalTimeSpent(userId)
      
      // Calculate learning streak (mock calculation)
      const streak = this.calculateLearningStreak(userId)
      
      const stats: UserStats = {
        totalCourses: userEnrollments.length,
        completedCourses,
        inProgressCourses,
        totalBadges: userAchievements.filter(a => a.type === 'BADGE').length,
        totalCertificates: userAchievements.filter(a => a.type === 'CERTIFICATE').length,
        averageScore,
        totalTimeSpent,
        streak,
        lastActive: this.getLastActiveDate(userId)
      }
      
      return stats
    } catch (error) {
      console.error('Error fetching user stats:', error)
      return null
    }
  }
  
  async getUsersByRole(role: string): Promise<UserProfile[]> {
    try {
      const profiles = Array.from(this.userProfiles.values())
      return profiles.filter(profile => profile.role === role)
    } catch (error) {
      console.error('Error fetching users by role:', error)
      return []
    }
  }
  
  async getAllUsers(filters?: {
    role?: string
    isActive?: boolean
    organizationId?: string
    limit?: number
    offset?: number
  }): Promise<{ users: UserProfile[]; total: number }> {
    try {
      let profiles = Array.from(this.userProfiles.values())
      
      // Apply filters
      if (filters?.role) {
        profiles = profiles.filter(p => p.role === filters.role)
      }
      
      if (filters?.isActive !== undefined) {
        profiles = profiles.filter(p => p.isActive === filters.isActive)
      }
      
      if (filters?.organizationId) {
        profiles = profiles.filter(p => p.organizationId === filters.organizationId)
      }
      
      const total = profiles.length
      
      // Apply pagination
      if (filters?.offset !== undefined) {
        profiles = profiles.slice(filters.offset)
      }
      
      if (filters?.limit !== undefined) {
        profiles = profiles.slice(0, filters.limit)
      }
      
      return { users: profiles, total }
    } catch (error) {
      console.error('Error fetching all users:', error)
      return { users: [], total: 0 }
    }
  }
  
  async enrollUserInCourse(userId: string, courseId: string): Promise<Enrollment | null> {
    try {
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
        progress: 0
      }
      
      this.enrollments.push(enrollment)
      
      // Update user profile enrollments
      const profile = await this.getUserProfile(userId)
      if (profile) {
        profile.enrollments.push(enrollment)
        this.userProfiles.set(userId, profile)
      }
      
      return enrollment
    } catch (error) {
      console.error('Error enrolling user in course:', error)
      return null
    }
  }
  
  async updateUserProgress(userId: string, courseId: string, progress: number): Promise<boolean> {
    try {
      const enrollment = this.enrollments.find(
        e => e.userId === userId && e.courseId === courseId
      )
      
      if (!enrollment) {
        throw new Error('Enrollment not found')
      }
      
      enrollment.progress = Math.min(100, Math.max(0, progress))
      enrollment.lastAccessedAt = new Date()
      
      // Mark as completed if progress reaches 100%
      if (enrollment.progress >= 100 && enrollment.status === 'ACTIVE') {
        enrollment.status = 'COMPLETED'
        enrollment.completedAt = new Date()
        
        // Award completion achievement
        await this.awardCompletionAchievement(userId, courseId)
      }
      
      return true
    } catch (error) {
      console.error('Error updating user progress:', error)
      return false
    }
  }
  
  async awardAchievement(userId: string, achievement: Omit<Achievement, 'id' | 'earnedAt'>): Promise<Achievement | null> {
    try {
      const newAchievement: Achievement = {
        ...achievement,
        id: Math.random().toString(36).substr(2, 9),
        earnedAt: new Date()
      }
      
      this.achievements.push(newAchievement)
      
      // Update user profile
      const profile = await this.getUserProfile(userId)
      if (profile) {
        profile.achievements.push(newAchievement)
        this.userProfiles.set(userId, profile)
      }
      
      // Send achievement notification (mock)
      await this.sendAchievementNotification(userId, newAchievement)
      
      return newAchievement
    } catch (error) {
      console.error('Error awarding achievement:', error)
      return null
    }
  }
  
  async deactivateUser(userId: string): Promise<boolean> {
    try {
      const profile = await this.getUserProfile(userId)
      if (!profile) {
        throw new Error('User not found')
      }
      
      profile.isActive = false
      profile.updatedAt = new Date()
      
      this.userProfiles.set(userId, profile)
      
      // Suspend all active enrollments
      this.enrollments
        .filter(e => e.userId === userId && e.status === 'ACTIVE')
        .forEach(e => e.status = 'SUSPENDED')
      
      return true
    } catch (error) {
      console.error('Error deactivating user:', error)
      return false
    }
  }
  
  async reactivateUser(userId: string): Promise<boolean> {
    try {
      const profile = await this.getUserProfile(userId)
      if (!profile) {
        throw new Error('User not found')
      }
      
      profile.isActive = true
      profile.updatedAt = new Date()
      
      this.userProfiles.set(userId, profile)
      
      // Reactivate suspended enrollments
      this.enrollments
        .filter(e => e.userId === userId && e.status === 'SUSPENDED')
        .forEach(e => e.status = 'ACTIVE')
      
      return true
    } catch (error) {
      console.error('Error reactivating user:', error)
      return false
    }
  }
  
  private async createDefaultProfile(userId: string): Promise<UserProfile> {
    // This would typically fetch basic user info from auth service
    const defaultProfile: UserProfile = {
      id: userId,
      email: `user-${userId}@example.com`,
      firstName: 'User',
      lastName: 'Name',
      role: 'LEARNER',
      verified: true,
      requires2FA: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      skills: [],
      achievements: [],
      enrollments: [],
      preferences: {
        language: 'en',
        timezone: 'UTC',
        notifications: {
          email: true,
          push: true,
          inApp: true,
          courseUpdates: true,
          assessmentReminders: true,
          achievementAlerts: true
        },
        learningStyle: 'VISUAL',
        difficultyPreference: 'BEGINNER'
      },
      isActive: true
    }
    
    this.userProfiles.set(userId, defaultProfile)
    return defaultProfile
  }
  
  private calculateAverageScore(userId: string): number {
    // Mock calculation - in real implementation, calculate from assessment scores
    return Math.floor(Math.random() * 30) + 70 // Random score between 70-100
  }
  
  private calculateTotalTimeSpent(userId: string): number {
    // Mock calculation - in real implementation, sum up actual time tracking
    return Math.floor(Math.random() * 5000) + 1000 // Random minutes
  }
  
  private calculateLearningStreak(userId: string): number {
    // Mock calculation - in real implementation, calculate consecutive learning days
    return Math.floor(Math.random() * 30) + 1
  }
  
  private getLastActiveDate(userId: string): Date {
    // Mock - in real implementation, get from activity tracking
    return new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000) // Random date within last week
  }
  
  private async awardCompletionAchievement(userId: string, courseId: string): Promise<void> {
    await this.awardAchievement(userId, {
      type: 'BADGE',
      title: 'Course Completed',
      description: 'Successfully completed a course',
      level: 'BRONZE',
      courseId
    })
  }
  
  private async sendAchievementNotification(userId: string, achievement: Achievement): Promise<void> {
    // Mock notification sending
    console.log(`Sending achievement notification to user ${userId}:`, achievement.title)
  }
}

// Export singleton instance
export const userService = new UserService()