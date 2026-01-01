import {
  SESv2Client,
  SendEmailCommand,
  SendBulkEmailCommand,
  CreateEmailTemplateCommand,
  UpdateEmailTemplateCommand,
  DeleteEmailTemplateCommand,
  GetEmailTemplateCommand,
  ListEmailTemplatesCommand,
  type SendEmailCommandInput,
  type SendBulkEmailCommandInput,
  type EmailTemplateContent,
} from '@aws-sdk/client-sesv2';

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface SendEmailOptions {
  to: EmailAddress | EmailAddress[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: Record<string, string>;
  configurationSetName?: string;
}

export interface SendBulkEmailOptions {
  recipients: Array<{
    to: EmailAddress;
    replacementData?: Record<string, string>;
  }>;
  subject: string;
  html: string;
  text?: string;
  defaultReplacementData?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface SESTemplate {
  name: string;
  subject: string;
  html: string;
  text?: string;
}

export function createSESClient() {
  const client = new SESv2Client({
    region: process.env.SES_REGION || process.env.AWS_REGION || 'us-east-1',
  });

  const senderEmail = process.env.SES_SENDER_EMAIL || 'noreply@campfire.app';
  const senderName = process.env.SES_SENDER_NAME || 'Campfire';
  const replyToEmail = process.env.SES_REPLY_TO_EMAIL || senderEmail;
  const configurationSet = process.env.SES_CONFIGURATION_SET;
  const sandboxMode = process.env.SES_SANDBOX_MODE === 'true';

  const formatAddress = (addr: EmailAddress): string =>
    addr.name ? `${addr.name} <${addr.email}>` : addr.email;

  return {
    /**
     * Send a single email
     */
    async send(options: SendEmailOptions): Promise<string> {
      const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

      const input: SendEmailCommandInput = {
        FromEmailAddress: `${senderName} <${senderEmail}>`,
        Destination: {
          ToAddresses: toAddresses.map(formatAddress),
        },
        ReplyToAddresses: [options.replyTo || replyToEmail],
        Content: {
          Simple: {
            Subject: { Data: options.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: options.html, Charset: 'UTF-8' },
              ...(options.text && { Text: { Data: options.text, Charset: 'UTF-8' } }),
            },
          },
        },
        ConfigurationSetName: options.configurationSetName || configurationSet,
        EmailTags: options.tags
          ? Object.entries(options.tags).map(([Name, Value]) => ({ Name, Value }))
          : undefined,
      };

      const command = new SendEmailCommand(input);
      const response = await client.send(command);
      return response.MessageId || '';
    },

    /**
     * Send bulk emails (for campaigns)
     */
    async sendBulk(options: SendBulkEmailOptions): Promise<string[]> {
      const input: SendBulkEmailCommandInput = {
        FromEmailAddress: `${senderName} <${senderEmail}>`,
        ReplyToAddresses: [replyToEmail],
        DefaultContent: {
          Template: {
            TemplateContent: {
              Subject: options.subject,
              Html: options.html,
              Text: options.text,
            },
            TemplateData: JSON.stringify(options.defaultReplacementData || {}),
          },
        },
        BulkEmailEntries: options.recipients.map((recipient) => ({
          Destination: {
            ToAddresses: [formatAddress(recipient.to)],
          },
          ReplacementEmailContent: recipient.replacementData
            ? {
                ReplacementTemplate: {
                  ReplacementTemplateData: JSON.stringify(recipient.replacementData),
                },
              }
            : undefined,
        })),
        ConfigurationSetName: configurationSet,
        DefaultEmailTags: options.tags
          ? Object.entries(options.tags).map(([Name, Value]) => ({ Name, Value }))
          : undefined,
      };

      const command = new SendBulkEmailCommand(input);
      const response = await client.send(command);
      return response.BulkEmailEntryResults?.map((r) => r.MessageId || '') || [];
    },

    /**
     * Create an email template in SES
     */
    async createTemplate(template: SESTemplate): Promise<void> {
      const command = new CreateEmailTemplateCommand({
        TemplateName: template.name,
        TemplateContent: {
          Subject: template.subject,
          Html: template.html,
          Text: template.text,
        },
      });
      await client.send(command);
    },

    /**
     * Update an email template
     */
    async updateTemplate(template: SESTemplate): Promise<void> {
      const command = new UpdateEmailTemplateCommand({
        TemplateName: template.name,
        TemplateContent: {
          Subject: template.subject,
          Html: template.html,
          Text: template.text,
        },
      });
      await client.send(command);
    },

    /**
     * Delete an email template
     */
    async deleteTemplate(templateName: string): Promise<void> {
      const command = new DeleteEmailTemplateCommand({
        TemplateName: templateName,
      });
      await client.send(command);
    },

    /**
     * Get a template by name
     */
    async getTemplate(templateName: string): Promise<EmailTemplateContent | null> {
      try {
        const command = new GetEmailTemplateCommand({
          TemplateName: templateName,
        });
        const response = await client.send(command);
        return response.TemplateContent || null;
      } catch {
        return null;
      }
    },

    /**
     * List all templates
     */
    async listTemplates(nextToken?: string): Promise<{
      templates: string[];
      nextToken?: string;
    }> {
      const command = new ListEmailTemplatesCommand({
        NextToken: nextToken,
        PageSize: 100,
      });
      const response = await client.send(command);
      return {
        templates: response.TemplatesMetadata?.map((t) => t.TemplateName || '') || [],
        nextToken: response.NextToken,
      };
    },

    /** Expose config for debugging */
    getConfig: () => ({
      senderEmail,
      senderName,
      replyToEmail,
      configurationSet,
      sandboxMode,
      region: process.env.SES_REGION || process.env.AWS_REGION,
    }),
  };
}

export type SESClient = ReturnType<typeof createSESClient>;
