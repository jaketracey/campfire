import { z } from 'zod';
import { nanoid } from 'nanoid';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { createSESClient, type SESClient } from './ses-client.js';
import {
  compileTemplate,
  generateUnsubscribeUrl,
  generatePreferencesUrl,
  verifyUnsubscribeToken,
  getDefaultSubject,
  type TemplateType,
} from './templates/index.js';
import type { DbClient } from '../db/client.js';

// Validation schemas
export const EmailJobDataSchema = z.object({
  jobId: z.string(),
  type: z.enum(['transactional', 'notification', 'marketing']),
  templateName: z.string(),
  recipientUserId: z.string().optional(),
  recipientEmail: z.string().email(),
  recipientName: z.string().optional(),
  context: z.record(z.unknown()),
  metadata: z.object({
    traceId: z.string(),
    correlationId: z.string().optional(),
    causationId: z.string().optional(),
    campaignId: z.string().optional(),
  }),
  scheduledFor: z.string().datetime().optional(),
  priority: z.enum(['high', 'normal', 'low']).default('normal'),
});

export type EmailJobData = z.infer<typeof EmailJobDataSchema>;

export interface EmailServiceConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  baseUrl?: string;
}

export interface SendTransactionalOptions {
  templateName: TemplateType;
  recipientUserId?: string;
  recipientEmail: string;
  recipientName?: string;
  context: Record<string, unknown>;
  traceId: string;
  priority?: 'high' | 'normal' | 'low';
}

export interface SendNotificationOptions {
  recipientUserId: string;
  recipientEmail: string;
  recipientName?: string;
  title: string;
  body: string;
  actionUrl?: string;
  actionText?: string;
  traceId: string;
}

export interface SendBulkOptions {
  templateName: TemplateType;
  recipients: Array<{
    userId?: string;
    email: string;
    name?: string;
    context?: Record<string, unknown>;
  }>;
  campaignId: string;
  traceId: string;
}

export class EmailService {
  private ses: SESClient;
  private queue: Queue<EmailJobData>;
  private db: DbClient;
  private logger: Logger;
  private baseUrl: string;

  constructor(config: EmailServiceConfig) {
    this.ses = createSESClient();
    this.db = config.db;
    this.logger = config.logger;
    this.baseUrl = config.baseUrl || process.env.WEB_URL || 'https://campfire.app';

    this.queue = new Queue<EmailJobData>('email', {
      connection: config.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }

  /**
   * Queue a transactional email (password reset, verification, etc.)
   */
  async sendTransactional(options: SendTransactionalOptions): Promise<string> {
    // Check if user has unsubscribed from transactional emails
    if (options.recipientUserId) {
      const canSend = await this.canSendToUser(options.recipientUserId, 'transactional');
      if (!canSend) {
        this.logger.warn(
          { userId: options.recipientUserId },
          'Cannot send transactional email - user blocked'
        );
        throw new Error('User has blocked all emails');
      }
    }

    const jobId = nanoid();
    const jobData: EmailJobData = {
      jobId,
      type: 'transactional',
      templateName: options.templateName,
      recipientUserId: options.recipientUserId,
      recipientEmail: options.recipientEmail,
      recipientName: options.recipientName,
      context: options.context,
      metadata: {
        traceId: options.traceId,
      },
      priority: options.priority || 'high',
    };

    await this.queue.add('send', jobData, {
      priority: options.priority === 'high' ? 1 : options.priority === 'low' ? 3 : 2,
      jobId,
    });

    // Log email queued
    await this.logEmail({
      jobId,
      userId: options.recipientUserId,
      recipientEmail: options.recipientEmail,
      templateName: options.templateName,
      type: 'transactional',
      status: 'queued',
      traceId: options.traceId,
    });

    this.logger.info({ jobId, template: options.templateName }, 'Transactional email queued');
    return jobId;
  }

  /**
   * Queue a notification email
   */
  async sendNotification(options: SendNotificationOptions): Promise<string> {
    // Check preferences
    const canSend = await this.canSendToUser(options.recipientUserId, 'notification');
    if (!canSend) {
      this.logger.debug(
        { userId: options.recipientUserId },
        'Skipping notification - user opted out'
      );
      return '';
    }

    return this.sendTransactional({
      templateName: 'notification',
      recipientUserId: options.recipientUserId,
      recipientEmail: options.recipientEmail,
      recipientName: options.recipientName,
      context: {
        title: options.title,
        body: options.body,
        actionUrl: options.actionUrl,
        actionText: options.actionText,
      },
      traceId: options.traceId,
      priority: 'normal',
    });
  }

  /**
   * Queue bulk marketing emails (newsletter, campaigns)
   */
  async sendBulk(options: SendBulkOptions): Promise<string[]> {
    const jobIds: string[] = [];

    for (const recipient of options.recipients) {
      // Check if user can receive marketing emails
      if (recipient.userId) {
        const canSend = await this.canSendToUser(recipient.userId, 'marketing');
        if (!canSend) {
          continue;
        }
      } else {
        // Check global unsubscribe list for non-users
        const isUnsubscribed = await this.isEmailSuppressed(recipient.email);
        if (isUnsubscribed) {
          continue;
        }
      }

      const jobId = nanoid();
      const jobData: EmailJobData = {
        jobId,
        type: 'marketing',
        templateName: options.templateName,
        recipientUserId: recipient.userId,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        context: recipient.context || {},
        metadata: {
          traceId: options.traceId,
          campaignId: options.campaignId,
        },
        priority: 'low',
      };

      await this.queue.add('send', jobData, {
        priority: 3,
        jobId,
      });

      await this.logEmail({
        jobId,
        userId: recipient.userId,
        recipientEmail: recipient.email,
        templateName: options.templateName,
        type: 'marketing',
        status: 'queued',
        traceId: options.traceId,
        campaignId: options.campaignId,
      });

      jobIds.push(jobId);
    }

    this.logger.info(
      { campaignId: options.campaignId, count: jobIds.length },
      'Bulk emails queued'
    );

    return jobIds;
  }

  /**
   * Process an email from the queue (called by worker)
   */
  async processEmail(jobData: EmailJobData): Promise<{ messageId: string }> {
    const { templateName, recipientEmail, recipientName, context, recipientUserId, metadata } =
      jobData;

    // Build full context with unsubscribe URLs
    const unsubscribeUrl = recipientUserId
      ? generateUnsubscribeUrl(recipientUserId, jobData.type, this.baseUrl)
      : generateUnsubscribeUrl(recipientEmail, jobData.type, this.baseUrl);

    const preferencesUrl = recipientUserId
      ? generatePreferencesUrl(recipientUserId, this.baseUrl)
      : generatePreferencesUrl(recipientEmail, this.baseUrl);

    const fullContext = {
      ...context,
      recipientEmail,
      recipientName,
      unsubscribeUrl,
      preferencesUrl,
      year: new Date().getFullYear(),
    };

    // Compile template
    const { html, text, errors } = compileTemplate(
      templateName as TemplateType,
      fullContext as any
    );

    if (errors.length > 0) {
      this.logger.warn({ errors, template: templateName }, 'Template compilation warnings');
    }

    // Determine subject from context or template
    const subject = (context.subject as string) || getDefaultSubject(templateName);

    // Send via SES
    const messageId = await this.ses.send({
      to: { email: recipientEmail, name: recipientName },
      subject,
      html,
      text,
      tags: {
        template: templateName,
        type: jobData.type,
        ...(metadata.campaignId && { campaign: metadata.campaignId }),
      },
    });

    // Update log
    await this.updateEmailLog(jobData.jobId, {
      status: 'sent',
      messageId,
      sentAt: new Date(),
    });

    this.logger.info(
      { jobId: jobData.jobId, messageId, template: templateName },
      'Email sent successfully'
    );

    return { messageId };
  }

  /**
   * Handle email delivery failure
   */
  async handleFailure(jobData: EmailJobData, error: Error): Promise<void> {
    await this.updateEmailLog(jobData.jobId, {
      status: 'failed',
      error: error.message,
      failedAt: new Date(),
    });

    this.logger.error({ jobId: jobData.jobId, error: error.message }, 'Email delivery failed');
  }

  /**
   * Process bounce notification from SES
   */
  async handleBounce(notification: {
    messageId: string;
    bounceType: 'Permanent' | 'Transient' | 'Undetermined';
    bounceSubType: string;
    bouncedRecipients: Array<{
      emailAddress: string;
      action?: string;
      status?: string;
      diagnosticCode?: string;
    }>;
    timestamp: string;
  }): Promise<void> {
    for (const recipient of notification.bouncedRecipients) {
      // Log bounce
      await this.db.sql`
        INSERT INTO email_bounces (
          message_id, email, bounce_type, bounce_subtype,
          action, status, diagnostic_code, bounced_at
        ) VALUES (
          ${notification.messageId}, ${recipient.emailAddress},
          ${notification.bounceType}, ${notification.bounceSubType},
          ${recipient.action || null}, ${recipient.status || null},
          ${recipient.diagnosticCode || null}, ${notification.timestamp}
        )
      `;

      // For permanent bounces, add to suppression list
      if (notification.bounceType === 'Permanent') {
        await this.db.sql`
          INSERT INTO email_suppressions (email, reason, suppressed_at)
          VALUES (${recipient.emailAddress}, 'hard_bounce', NOW())
          ON CONFLICT (email) DO UPDATE SET
            reason = 'hard_bounce',
            suppressed_at = NOW()
        `;
      }

      this.logger.warn(
        { email: recipient.emailAddress, bounceType: notification.bounceType },
        'Email bounce recorded'
      );
    }
  }

  /**
   * Process complaint notification from SES
   */
  async handleComplaint(notification: {
    messageId: string;
    complainedRecipients: Array<{ emailAddress: string }>;
    complaintFeedbackType?: string;
    timestamp: string;
  }): Promise<void> {
    for (const recipient of notification.complainedRecipients) {
      // Log complaint
      await this.db.sql`
        INSERT INTO email_complaints (
          message_id, email, feedback_type, complained_at
        ) VALUES (
          ${notification.messageId}, ${recipient.emailAddress},
          ${notification.complaintFeedbackType || 'unknown'}, ${notification.timestamp}
        )
      `;

      // Add to suppression list
      await this.db.sql`
        INSERT INTO email_suppressions (email, reason, suppressed_at)
        VALUES (${recipient.emailAddress}, 'complaint', NOW())
        ON CONFLICT (email) DO UPDATE SET
          reason = 'complaint',
          suppressed_at = NOW()
      `;

      // Update user preferences if we can identify them
      await this.db.sql`
        UPDATE email_preferences
        SET marketing_enabled = FALSE, updated_at = NOW()
        WHERE email = ${recipient.emailAddress}
      `;

      this.logger.warn(
        { email: recipient.emailAddress },
        'Email complaint recorded - user suppressed'
      );
    }
  }

  /**
   * Process unsubscribe request
   */
  async processUnsubscribe(token: string): Promise<{ success: boolean; email?: string }> {
    const result = verifyUnsubscribeToken(token);

    if (!result.valid) {
      return { success: false };
    }

    const { identifier, emailType } = result;
    if (!identifier || !emailType) {
      return { success: false };
    }

    // Determine if identifier is userId or email
    const isEmail = identifier.includes('@');

    if (isEmail) {
      await this.updatePreferencesByEmail(identifier, emailType, false);
      return { success: true, email: identifier };
    } else {
      await this.updatePreferencesByUserId(identifier, emailType, false);
      const [user] = await this.db.sql`SELECT email FROM users WHERE id = ${identifier}`;
      return { success: true, email: user?.email };
    }
  }

  /**
   * Get email preferences for a user
   */
  async getPreferences(userId: string): Promise<{
    transactional: boolean;
    notification: boolean;
    marketing: boolean;
    digest: 'daily' | 'weekly' | 'never';
  }> {
    const [prefs] = await this.db.sql`
      SELECT transactional_enabled, notification_enabled, marketing_enabled, digest_frequency
      FROM email_preferences
      WHERE user_id = ${userId}
    `;

    return {
      transactional: prefs?.transactional_enabled ?? true,
      notification: prefs?.notification_enabled ?? true,
      marketing: prefs?.marketing_enabled ?? false,
      digest: prefs?.digest_frequency ?? 'never',
    };
  }

  /**
   * Update email preferences
   */
  async updatePreferences(
    userId: string,
    preferences: Partial<{
      transactional: boolean;
      notification: boolean;
      marketing: boolean;
      digest: 'daily' | 'weekly' | 'never';
    }>
  ): Promise<void> {
    await this.db.sql`
      INSERT INTO email_preferences (user_id, transactional_enabled, notification_enabled, marketing_enabled, digest_frequency)
      VALUES (
        ${userId},
        ${preferences.transactional ?? true},
        ${preferences.notification ?? true},
        ${preferences.marketing ?? false},
        ${preferences.digest ?? 'never'}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        transactional_enabled = COALESCE(${preferences.transactional ?? null}, email_preferences.transactional_enabled),
        notification_enabled = COALESCE(${preferences.notification ?? null}, email_preferences.notification_enabled),
        marketing_enabled = COALESCE(${preferences.marketing ?? null}, email_preferences.marketing_enabled),
        digest_frequency = COALESCE(${preferences.digest ?? null}, email_preferences.digest_frequency),
        updated_at = NOW()
    `;
  }

  // Private helpers

  private async canSendToUser(userId: string, emailType: string): Promise<boolean> {
    const [result] = await this.db.sql`
      SELECT
        CASE
          WHEN ${emailType} = 'transactional' THEN transactional_enabled
          WHEN ${emailType} = 'notification' THEN notification_enabled
          WHEN ${emailType} = 'marketing' THEN marketing_enabled
          ELSE TRUE
        END as can_send
      FROM email_preferences
      WHERE user_id = ${userId}
    `;

    // Default to true for transactional, false for marketing if no preferences exist
    if (!result) {
      return emailType !== 'marketing';
    }

    return result.can_send;
  }

  private async isEmailSuppressed(email: string): Promise<boolean> {
    const [result] = await this.db.sql`
      SELECT 1 FROM email_suppressions WHERE email = ${email}
    `;
    return !!result;
  }

  private async logEmail(data: {
    jobId: string;
    userId?: string;
    recipientEmail: string;
    templateName: string;
    type: string;
    status: string;
    traceId: string;
    campaignId?: string;
  }): Promise<void> {
    await this.db.sql`
      INSERT INTO email_logs (
        job_id, user_id, recipient_email, template_name,
        email_type, status, trace_id, campaign_id
      ) VALUES (
        ${data.jobId}, ${data.userId || null}, ${data.recipientEmail},
        ${data.templateName}, ${data.type}, ${data.status},
        ${data.traceId}, ${data.campaignId || null}
      )
    `;
  }

  private async updateEmailLog(
    jobId: string,
    updates: {
      status?: string;
      messageId?: string;
      sentAt?: Date;
      error?: string;
      failedAt?: Date;
    }
  ): Promise<void> {
    await this.db.sql`
      UPDATE email_logs SET
        status = COALESCE(${updates.status ?? null}, status),
        ses_message_id = COALESCE(${updates.messageId ?? null}, ses_message_id),
        sent_at = COALESCE(${updates.sentAt?.toISOString() ?? null}, sent_at),
        error = COALESCE(${updates.error ?? null}, error),
        failed_at = COALESCE(${updates.failedAt?.toISOString() ?? null}, failed_at),
        updated_at = NOW()
      WHERE job_id = ${jobId}
    `;
  }

  private async updatePreferencesByEmail(
    email: string,
    emailType: string,
    enabled: boolean
  ): Promise<void> {
    if (emailType === 'marketing') {
      await this.db.sql`
        UPDATE email_preferences SET marketing_enabled = ${enabled}, updated_at = NOW()
        WHERE email = ${email}
      `;
    } else if (emailType === 'notification') {
      await this.db.sql`
        UPDATE email_preferences SET notification_enabled = ${enabled}, updated_at = NOW()
        WHERE email = ${email}
      `;
    } else {
      await this.db.sql`
        UPDATE email_preferences SET transactional_enabled = ${enabled}, updated_at = NOW()
        WHERE email = ${email}
      `;
    }
  }

  private async updatePreferencesByUserId(
    userId: string,
    emailType: string,
    enabled: boolean
  ): Promise<void> {
    if (emailType === 'marketing') {
      await this.db.sql`
        UPDATE email_preferences SET marketing_enabled = ${enabled}, updated_at = NOW()
        WHERE user_id = ${userId}
      `;
    } else if (emailType === 'notification') {
      await this.db.sql`
        UPDATE email_preferences SET notification_enabled = ${enabled}, updated_at = NOW()
        WHERE user_id = ${userId}
      `;
    } else {
      await this.db.sql`
        UPDATE email_preferences SET transactional_enabled = ${enabled}, updated_at = NOW()
        WHERE user_id = ${userId}
      `;
    }
  }
}

// Singleton
let emailService: EmailService | null = null;

export function getEmailService(config?: EmailServiceConfig): EmailService {
  if (!emailService && config) {
    emailService = new EmailService(config);
  }
  if (!emailService) {
    throw new Error('Email service not initialized');
  }
  return emailService;
}
