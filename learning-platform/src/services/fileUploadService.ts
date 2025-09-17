import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import mime from 'mime-types';
import sharp from 'sharp';
import db from '@/lib/db';

export interface UploadConfig {
  maxFileSize: number; // in bytes
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  generateThumbnail?: boolean;
  optimizeImages?: boolean;
  virusScan?: boolean;
}

export interface UploadResult {
  success: boolean;
  file?: {
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    thumbnailUrl?: string;
    metadata?: Record<string, any>;
  };
  error?: string;
}

export interface FileMetadata {
  width?: number;
  height?: number;
  duration?: number;
  checksum: string;
  uploadedBy: string;
  uploadedAt: Date;
}

class FileUploadService {
  private uploadConfigs: Record<string, UploadConfig> = {
    // Course materials
    courseContent: {
      maxFileSize: 100 * 1024 * 1024, // 100MB
      allowedMimeTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'text/csv',
        'application/zip',
        'application/x-zip-compressed',
      ],
      allowedExtensions: ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.csv', '.zip'],
      virusScan: true,
    },

    // Course thumbnails
    courseThumbnail: {
      maxFileSize: 5 * 1024 * 1024, // 5MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      generateThumbnail: true,
      optimizeImages: true,
    },

    // Video content
    videoContent: {
      maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB
      allowedMimeTypes: [
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/avi',
        'video/mov',
        'video/wmv',
      ],
      allowedExtensions: ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv'],
      virusScan: true,
    },

    // Audio content
    audioContent: {
      maxFileSize: 100 * 1024 * 1024, // 100MB
      allowedMimeTypes: [
        'audio/mp3',
        'audio/wav',
        'audio/ogg',
        'audio/aac',
        'audio/flac',
      ],
      allowedExtensions: ['.mp3', '.wav', '.ogg', '.aac', '.flac'],
    },

    // User profile pictures
    profilePicture: {
      maxFileSize: 2 * 1024 * 1024, // 2MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      generateThumbnail: true,
      optimizeImages: true,
    },

    // Assignment submissions
    assignment: {
      maxFileSize: 50 * 1024 * 1024, // 50MB
      allowedMimeTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'image/jpeg',
        'image/png',
      ],
      allowedExtensions: ['.pdf', '.doc', '.docx', '.txt', '.jpg', '.jpeg', '.png'],
      virusScan: true,
    },
  };

  private readonly baseUploadPath = process.env.UPLOAD_PATH || './uploads';
  private readonly publicBaseUrl = process.env.PUBLIC_UPLOAD_URL || '/uploads';

  /**
   * Upload a file with validation and processing
   */
  async uploadFile(
    file: File,
    uploadType: string,
    userId: string,
    metadata?: Record<string, any>
  ): Promise<UploadResult> {
    try {
      const config = this.uploadConfigs[uploadType];
      if (!config) {
        return {
          success: false,
          error: 'Invalid upload type',
        };
      }

      // Validate file
      const validation = await this.validateFile(file, config);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error || 'Invalid file',
        };
      }

      // Generate unique filename
      const fileExtension = path.extname(file.name).toLowerCase();
      const uniqueFilename = `${uuidv4()}${fileExtension}`;
      
      // Create directory structure
      const uploadDir = path.join(this.baseUploadPath, uploadType, new Date().toISOString().split('T')[0] || 'unknown');
      await this.ensureDirectoryExists(uploadDir);
      
      const filePath = path.join(uploadDir, uniqueFilename);
      const relativeUrl = path.join(uploadType, new Date().toISOString().split('T')[0] || 'unknown', uniqueFilename).replace(/\\/g, '/');
      
      // Save file to disk
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(filePath, buffer);

      // Calculate checksum
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

      // Process file based on type
      let thumbnailUrl: string | undefined;
      let processedMetadata: Record<string, any> = { ...metadata };

      if (config.generateThumbnail && this.isImage(file.type)) {
        thumbnailUrl = await this.generateThumbnail(filePath, relativeUrl);
      }

      if (config.optimizeImages && this.isImage(file.type)) {
        await this.optimizeImage(filePath, file.type);
      }

      // Extract additional metadata
      if (this.isImage(file.type)) {
        const imageMetadata = await this.extractImageMetadata(filePath);
        processedMetadata = { ...processedMetadata, ...imageMetadata };
      }

      // Virus scan if enabled
      if (config.virusScan) {
        const scanResult = await this.performVirusScan(filePath);
        if (!scanResult.clean) {
          await fs.unlink(filePath);
          return {
            success: false,
            error: 'File failed virus scan',
          };
        }
      }

      // Save to database
      const dbFile = await db.mediaFile.create({
        data: {
          filename: uniqueFilename,
          originalName: file.name,
          mimeType: file.type,
          size: file.size,
          url: `${this.publicBaseUrl}/${relativeUrl}`,
          thumbnailUrl: thumbnailUrl ? `${this.publicBaseUrl}/${thumbnailUrl}` : null,
          uploadedBy: userId,
          metadata: {
            checksum,
            uploadType,
            ...processedMetadata,
          },
        },
      });

      // Log upload activity
      await this.logUploadActivity(userId, 'FILE_UPLOADED', {
        fileId: dbFile.id,
        filename: file.name,
        size: file.size,
        type: uploadType,
      });

      return {
        success: true,
        file: {
          id: dbFile.id,
          filename: dbFile.filename,
          originalName: dbFile.originalName,
          mimeType: dbFile.mimeType,
          size: dbFile.size,
          url: dbFile.url,
          thumbnailUrl: dbFile.thumbnailUrl || undefined,
          metadata: dbFile.metadata as Record<string, any>,
        },
      };

    } catch (error) {
      console.error('File upload failed:', error);
      return {
        success: false,
        error: 'Upload failed due to system error',
      };
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(fileId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const file = await db.mediaFile.findUnique({
        where: { id: fileId },
      });

      if (!file) {
        return { success: false, error: 'File not found' };
      }

      // Check permissions (only uploader or admin can delete)
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (file.uploadedBy !== userId && user?.role !== 'ADMIN') {
        return { success: false, error: 'Insufficient permissions' };
      }

      // Delete file from disk
      const filePath = this.urlToFilePath(file.url);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        console.warn('Failed to delete file from disk:', error);
      }

      // Delete thumbnail if exists
      if (file.thumbnailUrl) {
        const thumbnailPath = this.urlToFilePath(file.thumbnailUrl);
        try {
          await fs.unlink(thumbnailPath);
        } catch (error) {
          console.warn('Failed to delete thumbnail from disk:', error);
        }
      }

      // Remove from database
      await db.mediaFile.delete({
        where: { id: fileId },
      });

      // Log deletion activity
      await this.logUploadActivity(userId, 'FILE_DELETED', {
        fileId,
        filename: file.originalName,
      });

      return { success: true };

    } catch (error) {
      console.error('File deletion failed:', error);
      return { success: false, error: 'Deletion failed due to system error' };
    }
  }

  /**
   * Get file information
   */
  async getFileInfo(fileId: string): Promise<UploadResult['file'] | null> {
    try {
      const file = await db.mediaFile.findUnique({
        where: { id: fileId },
      });

      if (!file) {
        return null;
      }

      return {
        id: file.id,
        filename: file.filename,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        url: file.url,
        thumbnailUrl: file.thumbnailUrl || undefined,
        metadata: file.metadata as Record<string, any>,
      };

    } catch (error) {
      console.error('Get file info failed:', error);
      return null;
    }
  }

  /**
   * Get files uploaded by user
   */
  async getUserFiles(userId: string, uploadType?: string): Promise<UploadResult['file'][]> {
    try {
      const files = await db.mediaFile.findMany({
        where: {
          uploadedBy: userId,
          ...(uploadType ? {
            metadata: {
              path: ['uploadType'],
              equals: uploadType,
            }
          } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });

      return files.map(file => ({
        id: file.id,
        filename: file.filename,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        url: file.url,
        thumbnailUrl: file.thumbnailUrl || undefined,
        metadata: file.metadata as Record<string, any>,
      }));

    } catch (error) {
      console.error('Get user files failed:', error);
      return [];
    }
  }

  /**
   * Clean up orphaned files
   */
  async cleanupOrphanedFiles(): Promise<number> {
    try {
      // Find files older than 24 hours that aren't referenced
      const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const orphanedFiles = await db.mediaFile.findMany({
        where: {
          createdAt: { lt: cutoffDate },
          // Add additional conditions to check if file is referenced
          // This would depend on your specific business logic
        },
      });

      let deletedCount = 0;
      for (const file of orphanedFiles) {
        try {
          const filePath = this.urlToFilePath(file.url);
          await fs.unlink(filePath);
          
          if (file.thumbnailUrl) {
            const thumbnailPath = this.urlToFilePath(file.thumbnailUrl);
            await fs.unlink(thumbnailPath);
          }

          await db.mediaFile.delete({
            where: { id: file.id },
          });

          deletedCount++;
        } catch (error) {
          console.warn(`Failed to delete orphaned file ${file.id}:`, error);
        }
      }

      return deletedCount;

    } catch (error) {
      console.error('Orphaned file cleanup failed:', error);
      return 0;
    }
  }

  private async validateFile(file: File, config: UploadConfig): Promise<{ valid: boolean; error?: string }> {
    // Check file size
    if (file.size > config.maxFileSize) {
      return {
        valid: false,
        error: `File size exceeds limit of ${Math.round(config.maxFileSize / (1024 * 1024))}MB`,
      };
    }

    // Check MIME type
    if (!config.allowedMimeTypes.includes(file.type)) {
      return {
        valid: false,
        error: 'File type not allowed',
      };
    }

    // Check file extension
    const fileExtension = path.extname(file.name).toLowerCase();
    if (!config.allowedExtensions.includes(fileExtension)) {
      return {
        valid: false,
        error: 'File extension not allowed',
      };
    }

    return { valid: true };
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      console.error('Failed to create directory:', error);
      throw new Error('Directory creation failed');
    }
  }

  private async generateThumbnail(filePath: string, originalUrl: string): Promise<string> {
    try {
      const thumbnailFilename = `thumb_${path.basename(filePath, path.extname(filePath))}.webp`;
      const thumbnailPath = path.join(path.dirname(filePath), thumbnailFilename);
      const thumbnailUrl = path.join(path.dirname(originalUrl), thumbnailFilename).replace(/\\/g, '/');

      await sharp(filePath)
        .resize(300, 200, { 
          fit: 'cover',
          position: 'center'
        })
        .webp({ quality: 80 })
        .toFile(thumbnailPath);

      return thumbnailUrl;
    } catch (error) {
      console.error('Thumbnail generation failed:', error);
      throw error;
    }
  }

  private async optimizeImage(filePath: string, mimeType: string): Promise<void> {
    try {
      const tempPath = `${filePath}.tmp`;
      
      let pipeline = sharp(filePath);

      if (mimeType === 'image/jpeg') {
        pipeline = pipeline.jpeg({ quality: 85, progressive: true });
      } else if (mimeType === 'image/png') {
        pipeline = pipeline.png({ compressionLevel: 8 });
      } else if (mimeType === 'image/webp') {
        pipeline = pipeline.webp({ quality: 85 });
      }

      await pipeline.toFile(tempPath);
      await fs.rename(tempPath, filePath);
    } catch (error) {
      console.error('Image optimization failed:', error);
      // Don't throw - optimization is optional
    }
  }

  private async extractImageMetadata(filePath: string): Promise<Record<string, any>> {
    try {
      const metadata = await sharp(filePath).metadata();
      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        hasAlpha: metadata.hasAlpha,
        density: metadata.density,
      };
    } catch (error) {
      console.error('Metadata extraction failed:', error);
      return {};
    }
  }

  private async performVirusScan(filePath: string): Promise<{ clean: boolean; threat?: string }> {
    // This is a placeholder for virus scanning integration
    // In a production environment, you would integrate with a service like:
    // - ClamAV
    // - VirusTotal API
    // - Windows Defender API
    // - Third-party scanning service
    
    try {
      // For now, just check file size and basic indicators
      const stats = await fs.stat(filePath);
      
      // Reject extremely small files (potential malware)
      if (stats.size < 10) {
        return { clean: false, threat: 'Suspicious file size' };
      }

      // In a real implementation, you would call your virus scanning service here
      return { clean: true };
    } catch (error) {
      console.error('Virus scan failed:', error);
      return { clean: false, threat: 'Scan error' };
    }
  }

  private isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  private urlToFilePath(url: string): string {
    const relativePath = url.replace(this.publicBaseUrl, '').replace(/^\//, '');
    return path.join(this.baseUploadPath, relativePath);
  }

  private async logUploadActivity(userId: string, action: string, details: Record<string, any>): Promise<void> {
    try {
      await db.activityLog.create({
        data: {
          userId,
          action,
          resource: 'file_upload',
          details,
          ipAddress: 'unknown',
          userAgent: 'unknown',
        }
      });
    } catch (error) {
      console.error('Failed to log upload activity:', error);
    }
  }
}

export const fileUploadService = new FileUploadService();