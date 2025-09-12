import nodemailer from 'nodemailer';
import { promises as fs } from 'fs';
import path from 'path';
import handlebars from 'handlebars';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  template?: string;
  templateData?: Record<string, any>;
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private templateCache = new Map<string, EmailTemplate>();

  constructor() {
    this.transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  /**
   * Send email with template support
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      let { html, text, subject } = options;

      // Use template if specified
      if (options.template) {
        const template = await this.getTemplate(options.template);
        const compiledSubject = handlebars.compile(template.subject);
        const compiledHtml = handlebars.compile(template.html);
        const compiledText = handlebars.compile(template.text);

        subject = compiledSubject(options.templateData || {});
        html = compiledHtml(options.templateData || {});
        text = compiledText(options.templateData || {});
      }

      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@learningplatform.com',
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject,
        html,
        text,
      });
    } catch (error) {
      console.error('Failed to send email:', error);
      throw new Error('Email delivery failed');
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password?token=${resetToken}`;
    
    await this.sendEmail({
      to: email,
      template: 'password-reset',
      templateData: {
        resetUrl,
        expiresIn: '24 hours',
      },
    });
  }

  /**
   * Send email verification email
   */
  async sendEmailVerification(email: string, verificationToken: string, firstName: string): Promise<void> {
    const verificationUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/verify-email?token=${verificationToken}`;
    
    await this.sendEmail({
      to: email,
      template: 'email-verification',
      templateData: {
        firstName,
        verificationUrl,
        expiresIn: '24 hours',
      },
    });
  }

  /**
   * Send welcome email after successful registration
   */
  async sendWelcomeEmail(email: string, firstName: string): Promise<void> {
    await this.sendEmail({
      to: email,
      template: 'welcome',
      templateData: {
        firstName,
        loginUrl: `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`,
      },
    });
  }

  /**
   * Send course enrollment confirmation
   */
  async sendEnrollmentConfirmation(email: string, userName: string, courseTitle: string): Promise<void> {
    await this.sendEmail({
      to: email,
      template: 'enrollment-confirmation',
      templateData: {
        userName,
        courseTitle,
        courseUrl: `${process.env.NEXT_PUBLIC_APP_URL}/courses`,
      },
    });
  }

  /**
   * Send course completion certificate
   */
  async sendCertificateEmail(email: string, userName: string, courseTitle: string, certificateUrl: string): Promise<void> {
    await this.sendEmail({
      to: email,
      template: 'certificate',
      templateData: {
        userName,
        courseTitle,
        certificateUrl,
      },
    });
  }

  /**
   * Send assessment reminder
   */
  async sendAssessmentReminder(email: string, userName: string, assessmentTitle: string, dueDate: Date): Promise<void> {
    await this.sendEmail({
      to: email,
      template: 'assessment-reminder',
      templateData: {
        userName,
        assessmentTitle,
        dueDate: dueDate.toLocaleDateString(),
        assessmentUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      },
    });
  }

  /**
   * Load and compile email template
   */
  private async getTemplate(templateName: string): Promise<EmailTemplate> {
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName)!;
    }

    try {
      const templatePath = path.join(process.cwd(), 'src/templates/emails', templateName);
      
      const [subjectFile, htmlFile, textFile] = await Promise.all([
        fs.readFile(`${templatePath}.subject.hbs`, 'utf-8'),
        fs.readFile(`${templatePath}.html.hbs`, 'utf-8'),
        fs.readFile(`${templatePath}.text.hbs`, 'utf-8'),
      ]);

      const template: EmailTemplate = {
        subject: subjectFile,
        html: htmlFile,
        text: textFile,
      };

      this.templateCache.set(templateName, template);
      return template;
    } catch (error) {
      console.error(`Failed to load email template: ${templateName}`, error);
      throw new Error(`Email template not found: ${templateName}`);
    }
  }

  /**
   * Test email configuration
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      console.error('Email configuration test failed:', error);
      return false;
    }
  }
}

export const emailService = new EmailService();