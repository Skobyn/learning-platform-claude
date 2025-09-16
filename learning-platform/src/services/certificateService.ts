import PDFDocument from 'pdfkit';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import QRCode from 'qrcode';
import db from '@/lib/db';
import { emailService } from './emailService';

export interface CertificateTemplate {
  id: string;
  name: string;
  type: 'COURSE_COMPLETION' | 'SKILL_MASTERY' | 'PARTICIPATION' | 'ACHIEVEMENT';
  layout: CertificateLayout;
  isActive: boolean;
}

export interface CertificateLayout {
  backgroundImage?: string;
  logoUrl?: string;
  title: {
    text: string;
    fontSize: number;
    color: string;
    position: { x: number; y: number };
  };
  recipientName: {
    fontSize: number;
    color: string;
    position: { x: number; y: number };
  };
  courseTitle: {
    fontSize: number;
    color: string;
    position: { x: number; y: number };
  };
  completionDate: {
    fontSize: number;
    color: string;
    position: { x: number; y: number };
  };
  signatures: Array<{
    name: string;
    title: string;
    imageUrl?: string;
    position: { x: number; y: number };
  }>;
  qrCode: {
    size: number;
    position: { x: number; y: number };
  };
}

export interface CertificateData {
  userId: string;
  courseId: string;
  templateId: string;
  recipientName: string;
  courseTitle: string;
  completionDate: Date;
  grade?: number;
  skills?: string[];
  metadata?: Record<string, any>;
}

export interface CertificateInfo {
  id: string;
  userId: string;
  courseId: string;
  templateId: string;
  issuedAt: Date;
  verificationCode: string;
  pdfUrl: string;
  metadata?: Record<string, any>;
  isValid: boolean;
}

export interface BlockchainCertificate {
  transactionHash?: string;
  blockNumber?: number;
  networkId?: string;
  contractAddress?: string;
  tokenId?: string;
}

class CertificateService {
  private readonly certificateBasePath = process.env.CERTIFICATE_STORAGE_PATH || './storage/certificates';
  private readonly publicCertificateUrl = process.env.PUBLIC_CERTIFICATE_URL || '/api/certificates';
  private readonly verificationBaseUrl = process.env.CERTIFICATE_VERIFICATION_URL || 'https://platform.com/verify';

  private defaultTemplates: CertificateTemplate[] = [
    {
      id: 'default-course-completion',
      name: 'Course Completion Certificate',
      type: 'COURSE_COMPLETION',
      isActive: true,
      layout: {
        title: {
          text: 'Certificate of Completion',
          fontSize: 32,
          color: '#1f2937',
          position: { x: 300, y: 150 }
        },
        recipientName: {
          fontSize: 28,
          color: '#059669',
          position: { x: 300, y: 250 }
        },
        courseTitle: {
          fontSize: 20,
          color: '#374151',
          position: { x: 300, y: 320 }
        },
        completionDate: {
          fontSize: 16,
          color: '#6b7280',
          position: { x: 300, y: 380 }
        },
        signatures: [
          {
            name: 'Director of Education',
            title: 'Learning Platform',
            position: { x: 150, y: 480 }
          }
        ],
        qrCode: {
          size: 80,
          position: { x: 500, y: 450 }
        }
      }
    }
  ];

  /**
   * Generate certificate for course completion
   */
  async generateCertificate(certificateData: CertificateData): Promise<{
    success: boolean;
    certificateId?: string;
    pdfUrl?: string;
    verificationCode?: string;
    error?: string;
  }> {
    try {
      // Validate prerequisites
      const validation = await this.validateCertificateEligibility(
        certificateData.userId,
        certificateData.courseId
      );

      if (!validation.eligible) {
        return { success: false, error: validation.reason || 'Not eligible for certificate' };
      }

      // Check if certificate already exists
      const existingCertificate = await db.certificate.findFirst({
        where: {
          userId: certificateData.userId,
          courseId: certificateData.courseId,
        }
      });

      if (existingCertificate) {
        return {
          success: false,
          error: 'Certificate already issued for this course',
        };
      }

      // Generate verification code
      const verificationCode = this.generateVerificationCode();

      // Get template
      const template = this.getTemplate(certificateData.templateId);
      if (!template) {
        return { success: false, error: 'Certificate template not found' };
      }

      // Generate PDF
      const pdfResult = await this.createCertificatePDF(
        certificateData,
        template,
        verificationCode
      );

      if (!pdfResult.success) {
        return { success: false, error: pdfResult.error || 'Failed to generate PDF' };
      }

      // Store certificate record
      const certificate = await db.certificate.create({
        data: {
          userId: certificateData.userId,
          courseId: certificateData.courseId,
          templateId: certificateData.templateId,
          verificationCode,
          pdfUrl: pdfResult.pdfUrl!,
          issuedAt: new Date(),
          metadata: {
            recipientName: certificateData.recipientName,
            courseTitle: certificateData.courseTitle,
            completionDate: certificateData.completionDate,
            grade: certificateData.grade,
            skills: certificateData.skills,
            ...certificateData.metadata,
          }
        }
      });

      // Send certificate via email
      await this.sendCertificateByEmail(certificate.id);

      // Log certificate generation
      await this.logCertificateActivity(certificateData.userId, 'CERTIFICATE_GENERATED', {
        certificateId: certificate.id,
        courseId: certificateData.courseId,
        verificationCode,
      });

      return {
        success: true,
        certificateId: certificate.id,
        pdfUrl: pdfResult.pdfUrl || '',
        verificationCode,
      };

    } catch (error) {
      console.error('Certificate generation failed:', error);
      return { success: false, error: 'Certificate generation failed' };
    }
  }

  /**
   * Verify certificate by verification code
   */
  async verifyCertificate(verificationCode: string): Promise<{
    valid: boolean;
    certificate?: CertificateInfo;
    error?: string;
  }> {
    try {
      const certificate = await db.certificate.findUnique({
        where: { verificationCode },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            }
          },
          course: {
            select: {
              title: true,
              estimatedDuration: true,
            }
          }
        }
      });

      if (!certificate) {
        return { valid: false, error: 'Certificate not found' };
      }

      // Check if certificate is still valid (not revoked)
      if (certificate.metadata && (certificate.metadata as any).revoked) {
        return { valid: false, error: 'Certificate has been revoked' };
      }

      // Log verification attempt
      await this.logCertificateActivity(certificate.userId, 'CERTIFICATE_VERIFIED', {
        certificateId: certificate.id,
        verificationCode,
      });

      const certificateInfo: CertificateInfo = {
        id: certificate.id,
        userId: certificate.userId,
        courseId: certificate.courseId,
        templateId: certificate.templateId,
        issuedAt: certificate.issuedAt,
        verificationCode: certificate.verificationCode,
        pdfUrl: certificate.pdfUrl,
        metadata: {
          recipientName: `${certificate.user.firstName} ${certificate.user.lastName}`,
          courseTitle: certificate.course.title,
          courseDuration: certificate.course.estimatedDuration,
          ...(certificate.metadata as Record<string, any>),
        },
        isValid: true,
      };

      return { valid: true, certificate: certificateInfo };

    } catch (error) {
      console.error('Certificate verification failed:', error);
      return { valid: false, error: 'Verification failed' };
    }
  }

  /**
   * Get user certificates
   */
  async getUserCertificates(userId: string): Promise<CertificateInfo[]> {
    try {
      const certificates = await db.certificate.findMany({
        where: { userId },
        include: {
          course: {
            select: {
              title: true,
              thumbnailUrl: true,
            }
          }
        },
        orderBy: { issuedAt: 'desc' }
      });

      return certificates.map(cert => ({
        id: cert.id,
        userId: cert.userId,
        courseId: cert.courseId,
        templateId: cert.templateId,
        issuedAt: cert.issuedAt,
        verificationCode: cert.verificationCode,
        pdfUrl: cert.pdfUrl,
        metadata: {
          courseTitle: cert.course.title,
          courseThumbnail: cert.course.thumbnailUrl,
          ...(cert.metadata as Record<string, any>),
        },
        isValid: !(cert.metadata as any)?.revoked,
      }));

    } catch (error) {
      console.error('Get user certificates failed:', error);
      return [];
    }
  }

  /**
   * Revoke certificate
   */
  async revokeCertificate(certificateId: string, reason: string, revokedBy: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const certificate = await db.certificate.findUnique({
        where: { id: certificateId }
      });

      if (!certificate) {
        return { success: false, error: 'Certificate not found' };
      }

      // Update certificate metadata to mark as revoked
      await db.certificate.update({
        where: { id: certificateId },
        data: {
          metadata: {
            ...(certificate.metadata as Record<string, any>),
            revoked: true,
            revokedAt: new Date(),
            revokedBy,
            revocationReason: reason,
          }
        }
      });

      // Log revocation
      await this.logCertificateActivity(certificate.userId, 'CERTIFICATE_REVOKED', {
        certificateId,
        reason,
        revokedBy,
      });

      return { success: true };

    } catch (error) {
      console.error('Certificate revocation failed:', error);
      return { success: false, error: 'Revocation failed' };
    }
  }

  /**
   * Get certificate statistics
   */
  async getCertificateStatistics(timeframe: 'day' | 'week' | 'month' = 'month'): Promise<{
    totalIssued: number;
    totalVerifications: number;
    certificatesByType: Record<string, number>;
    certificatesByCourse: Record<string, number>;
    recentActivity: Array<{
      action: string;
      timestamp: Date;
      details: Record<string, any>;
    }>;
  }> {
    try {
      const now = new Date();
      let startDate: Date;

      switch (timeframe) {
        case 'day':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }

      const [certificates, activities] = await Promise.all([
        db.certificate.findMany({
          where: { issuedAt: { gte: startDate } },
          include: {
            course: { select: { title: true } }
          }
        }),
        db.activityLog.findMany({
          where: {
            resource: 'certificate',
            createdAt: { gte: startDate }
          },
          orderBy: { createdAt: 'desc' },
          take: 20
        })
      ]);

      const certificatesByType = certificates.reduce((acc, cert) => {
        const template = this.getTemplate(cert.templateId);
        const type = template?.type || 'UNKNOWN';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const certificatesByCourse = certificates.reduce((acc, cert) => {
        const courseTitle = cert.course.title;
        acc[courseTitle] = (acc[courseTitle] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const verificationCount = activities.filter(a => 
        a.action === 'CERTIFICATE_VERIFIED'
      ).length;

      const recentActivity = activities.map(activity => ({
        action: activity.action,
        timestamp: activity.createdAt,
        details: activity.details as Record<string, any>,
      }));

      return {
        totalIssued: certificates.length,
        totalVerifications: verificationCount,
        certificatesByType,
        certificatesByCourse,
        recentActivity,
      };

    } catch (error) {
      console.error('Get certificate statistics failed:', error);
      return {
        totalIssued: 0,
        totalVerifications: 0,
        certificatesByType: {},
        certificatesByCourse: {},
        recentActivity: [],
      };
    }
  }

  /**
   * Create certificate PDF
   */
  private async createCertificatePDF(
    data: CertificateData,
    template: CertificateTemplate,
    verificationCode: string
  ): Promise<{ success: boolean; pdfUrl?: string; error?: string }> {
    try {
      // Create directory for certificates
      const certDir = path.join(this.certificateBasePath, data.userId);
      await fs.mkdir(certDir, { recursive: true });

      // Generate filename
      const filename = `certificate_${verificationCode}.pdf`;
      const filePath = path.join(certDir, filename);
      const publicUrl = `${this.publicCertificateUrl}/${data.userId}/${filename}`;

      // Create PDF document
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape' });
      
      // Pipe to file
      const stream = createWriteStream(filePath);
      doc.pipe(stream);

      // Add background if specified
      if (template.layout.backgroundImage) {
        // doc.image(template.layout.backgroundImage, 0, 0, { width: 842, height: 595 });
      }

      // Add logo if specified
      if (template.layout.logoUrl) {
        // doc.image(template.layout.logoUrl, 50, 50, { width: 100 });
      }

      // Add title
      doc.fontSize(template.layout.title.fontSize)
         .fillColor(template.layout.title.color)
         .text(
           template.layout.title.text,
           template.layout.title.position.x,
           template.layout.title.position.y,
           { align: 'center' }
         );

      // Add "This is to certify that"
      doc.fontSize(16)
         .fillColor('#6b7280')
         .text(
           'This is to certify that',
           0,
           template.layout.recipientName.position.y - 30,
           { align: 'center' }
         );

      // Add recipient name
      doc.fontSize(template.layout.recipientName.fontSize)
         .fillColor(template.layout.recipientName.color)
         .text(
           data.recipientName,
           template.layout.recipientName.position.x,
           template.layout.recipientName.position.y,
           { align: 'center' }
         );

      // Add "has successfully completed"
      doc.fontSize(16)
         .fillColor('#6b7280')
         .text(
           'has successfully completed',
           0,
           template.layout.courseTitle.position.y - 30,
           { align: 'center' }
         );

      // Add course title
      doc.fontSize(template.layout.courseTitle.fontSize)
         .fillColor(template.layout.courseTitle.color)
         .text(
           data.courseTitle,
           template.layout.courseTitle.position.x,
           template.layout.courseTitle.position.y,
           { align: 'center' }
         );

      // Add completion date
      doc.fontSize(template.layout.completionDate.fontSize)
         .fillColor(template.layout.completionDate.color)
         .text(
           `Completed on ${data.completionDate.toLocaleDateString()}`,
           template.layout.completionDate.position.x,
           template.layout.completionDate.position.y,
           { align: 'center' }
         );

      // Add grade if provided
      if (data.grade) {
        doc.fontSize(14)
           .fillColor('#059669')
           .text(
             `Final Grade: ${data.grade}%`,
             0,
             template.layout.completionDate.position.y + 30,
             { align: 'center' }
           );
      }

      // Add signatures
      for (const signature of template.layout.signatures) {
        doc.fontSize(12)
           .fillColor('#374151')
           .text(
             signature.name,
             signature.position.x,
             signature.position.y,
             { align: 'center', width: 150 }
           )
           .text(
             signature.title,
             signature.position.x,
             signature.position.y + 15,
             { align: 'center', width: 150 }
           );

        // Add signature line
        doc.strokeColor('#d1d5db')
           .lineWidth(1)
           .moveTo(signature.position.x, signature.position.y - 5)
           .lineTo(signature.position.x + 150, signature.position.y - 5)
           .stroke();
      }

      // Generate QR code for verification
      const verificationUrl = `${this.verificationBaseUrl}/${verificationCode}`;
      const qrCodeBuffer = await QRCode.toBuffer(verificationUrl, {
        width: template.layout.qrCode.size,
        margin: 0,
      });

      // Add QR code to PDF
      doc.image(
        qrCodeBuffer,
        template.layout.qrCode.position.x,
        template.layout.qrCode.position.y,
        { width: template.layout.qrCode.size }
      );

      // Add verification code text
      doc.fontSize(8)
         .fillColor('#9ca3af')
         .text(
           `Verification Code: ${verificationCode}`,
           template.layout.qrCode.position.x - 20,
           template.layout.qrCode.position.y + template.layout.qrCode.size + 5,
           { align: 'center', width: template.layout.qrCode.size + 40 }
         );

      // Finalize PDF
      doc.end();

      // Wait for PDF to be written
      await new Promise((resolve, reject) => {
        stream.on('finish', () => resolve(undefined));
        stream.on('error', reject);
      });

      return { success: true, pdfUrl: publicUrl };

    } catch (error) {
      console.error('PDF creation failed:', error);
      return { success: false, error: 'PDF creation failed' };
    }
  }

  private async validateCertificateEligibility(userId: string, courseId: string): Promise<{
    eligible: boolean;
    reason?: string;
  }> {
    try {
      // Check if user is enrolled and completed the course
      const enrollment = await db.enrollment.findFirst({
        where: {
          userId,
          courseId,
          status: 'COMPLETED',
          certificateIssued: false,
        }
      });

      if (!enrollment) {
        return {
          eligible: false,
          reason: 'User has not completed the course or certificate already issued'
        };
      }

      return { eligible: true };

    } catch (error) {
      console.error('Certificate eligibility validation failed:', error);
      return { eligible: false, reason: 'Validation failed' };
    }
  }

  private generateVerificationCode(): string {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
  }

  private getTemplate(templateId: string): CertificateTemplate | undefined {
    return this.defaultTemplates.find(t => t.id === templateId);
  }

  private async sendCertificateByEmail(certificateId: string): Promise<void> {
    try {
      const certificate = await db.certificate.findUnique({
        where: { id: certificateId },
        include: {
          user: {
            select: {
              firstName: true,
              email: true,
            }
          },
          course: {
            select: {
              title: true,
            }
          }
        }
      });

      if (certificate && certificate.user && certificate.course) {
        await emailService.sendCertificateEmail(
          certificate.user.email,
          certificate.user.firstName,
          certificate.course.title,
          certificate.pdfUrl
        );
      }
    } catch (error) {
      console.error('Failed to send certificate email:', error);
    }
  }

  private async logCertificateActivity(
    userId: string,
    action: string,
    details: Record<string, any>
  ): Promise<void> {
    try {
      await db.activityLog.create({
        data: {
          userId,
          action,
          resource: 'certificate',
          details,
          ipAddress: 'unknown',
          userAgent: 'unknown',
        }
      });
    } catch (error) {
      console.error('Failed to log certificate activity:', error);
    }
  }
}

export const certificateService = new CertificateService();