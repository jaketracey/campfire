/**
 * Email Webhook Routes
 * Handles SES notifications via SNS for bounces, complaints, and delivery status.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createVerify } from 'crypto';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';
import { withSpan } from '../observability/tracing.js';
import { getEventStore } from '../db/event-store.js';
import { nanoid } from 'nanoid';
import { EventTypes } from '@campfire/shared';

// SNS Message schemas
const SNSMessageSchema = z.object({
  Type: z.enum(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']),
  MessageId: z.string(),
  TopicArn: z.string(),
  Subject: z.string().optional(),
  Message: z.string(),
  Timestamp: z.string(),
  SignatureVersion: z.string(),
  Signature: z.string(),
  SigningCertURL: z.string().url(),
  UnsubscribeURL: z.string().url().optional(),
  SubscribeURL: z.string().url().optional(),
});

const SESBounceNotificationSchema = z.object({
  notificationType: z.literal('Bounce'),
  bounce: z.object({
    bounceType: z.enum(['Permanent', 'Transient', 'Undetermined']),
    bounceSubType: z.string(),
    bouncedRecipients: z.array(
      z.object({
        emailAddress: z.string().email(),
        action: z.string().optional(),
        status: z.string().optional(),
        diagnosticCode: z.string().optional(),
      })
    ),
    timestamp: z.string(),
    feedbackId: z.string(),
  }),
  mail: z.object({
    messageId: z.string(),
    source: z.string(),
    sourceArn: z.string().optional(),
    sendingAccountId: z.string().optional(),
    destination: z.array(z.string()),
    timestamp: z.string(),
  }),
});

const SESComplaintNotificationSchema = z.object({
  notificationType: z.literal('Complaint'),
  complaint: z.object({
    complainedRecipients: z.array(
      z.object({
        emailAddress: z.string().email(),
      })
    ),
    timestamp: z.string(),
    feedbackId: z.string(),
    complaintFeedbackType: z.string().optional(),
    userAgent: z.string().optional(),
  }),
  mail: z.object({
    messageId: z.string(),
    source: z.string(),
    destination: z.array(z.string()),
    timestamp: z.string(),
  }),
});

const SESDeliveryNotificationSchema = z.object({
  notificationType: z.literal('Delivery'),
  delivery: z.object({
    timestamp: z.string(),
    processingTimeMillis: z.number(),
    recipients: z.array(z.string()),
    smtpResponse: z.string(),
    remoteMtaIp: z.string().optional(),
  }),
  mail: z.object({
    messageId: z.string(),
    source: z.string(),
    destination: z.array(z.string()),
    timestamp: z.string(),
  }),
});

const SESOpenNotificationSchema = z.object({
  notificationType: z.literal('Open'),
  open: z.object({
    timestamp: z.string(),
    userAgent: z.string().optional(),
    ipAddress: z.string().optional(),
  }),
  mail: z.object({
    messageId: z.string(),
    source: z.string(),
    destination: z.array(z.string()),
    timestamp: z.string(),
  }),
});

const SESClickNotificationSchema = z.object({
  notificationType: z.literal('Click'),
  click: z.object({
    timestamp: z.string(),
    link: z.string(),
    linkTags: z.record(z.array(z.string())).optional(),
    userAgent: z.string().optional(),
    ipAddress: z.string().optional(),
  }),
  mail: z.object({
    messageId: z.string(),
    source: z.string(),
    destination: z.array(z.string()),
    timestamp: z.string(),
  }),
});

/**
 * Verify SNS message signature
 */
async function verifySNSSignature(
  message: z.infer<typeof SNSMessageSchema>
): Promise<boolean> {
  try {
    // Fetch the signing certificate
    const certResponse = await fetch(message.SigningCertURL);
    const cert = await certResponse.text();

    // Build the string to sign based on message type
    let stringToSign = '';
    if (message.Type === 'Notification') {
      const fields = ['Message', 'MessageId', 'Timestamp', 'TopicArn', 'Type'];
      if (message.Subject) fields.splice(1, 0, 'Subject');
      stringToSign = fields.map((f) => `${f}\n${(message as any)[f]}`).join('\n') + '\n';
    } else {
      stringToSign =
        [
          'Message',
          message.Message,
          'MessageId',
          message.MessageId,
          'SubscribeURL',
          message.SubscribeURL || '',
          'Timestamp',
          message.Timestamp,
          'Token',
          '',
          'TopicArn',
          message.TopicArn,
          'Type',
          message.Type,
        ].join('\n') + '\n';
    }

    const verify = createVerify('SHA1');
    verify.update(stringToSign);
    return verify.verify(cert, message.Signature, 'base64');
  } catch (error) {
    logger.error({ error }, 'Failed to verify SNS signature');
    return false;
  }
}

/**
 * Register email webhook routes
 */
export async function emailWebhookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /webhooks/email/sns - Handle SES notifications via SNS
   */
  app.post(
    '/sns',
    {
      config: {
        rawBody: true,
      } as Record<string, unknown>,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return withSpan('email.handleSNSWebhook', async (span) => {
        // Parse SNS message
        const parseResult = SNSMessageSchema.safeParse(request.body);
        if (!parseResult.success) {
          logger.warn({ errors: parseResult.error.flatten() }, 'Invalid SNS message');
          return reply.status(400).send({ error: 'Invalid SNS message' });
        }

        const snsMessage = parseResult.data;
        span.setAttributes({
          'sns.type': snsMessage.Type,
          'sns.messageId': snsMessage.MessageId,
          'sns.topicArn': snsMessage.TopicArn,
        });

        // Verify signature in production
        if (env.NODE_ENV === 'production') {
          const isValid = await verifySNSSignature(snsMessage);
          if (!isValid) {
            logger.warn({ messageId: snsMessage.MessageId }, 'Invalid SNS signature');
            return reply.status(403).send({ error: 'Invalid signature' });
          }
        }

        // Handle subscription confirmation
        if (snsMessage.Type === 'SubscriptionConfirmation') {
          logger.info(
            { topicArn: snsMessage.TopicArn },
            'SNS subscription confirmation received'
          );

          // Confirm the subscription by visiting the SubscribeURL
          if (snsMessage.SubscribeURL) {
            try {
              await fetch(snsMessage.SubscribeURL);
              logger.info({ topicArn: snsMessage.TopicArn }, 'SNS subscription confirmed');
            } catch (error) {
              logger.error(
                { error, topicArn: snsMessage.TopicArn },
                'Failed to confirm SNS subscription'
              );
            }
          }

          return reply.send({ status: 'confirmed' });
        }

        // Handle notification
        if (snsMessage.Type === 'Notification') {
          const message = JSON.parse(snsMessage.Message);
          const eventStore = getEventStore();

          // Determine notification type and process
          if (message.notificationType === 'Bounce') {
            const bounceResult = SESBounceNotificationSchema.safeParse(message);
            if (bounceResult.success) {
              await handleBounce(bounceResult.data, eventStore);
            }
          } else if (message.notificationType === 'Complaint') {
            const complaintResult = SESComplaintNotificationSchema.safeParse(message);
            if (complaintResult.success) {
              await handleComplaint(complaintResult.data, eventStore);
            }
          } else if (message.notificationType === 'Delivery') {
            const deliveryResult = SESDeliveryNotificationSchema.safeParse(message);
            if (deliveryResult.success) {
              await handleDelivery(deliveryResult.data);
            }
          } else if (message.notificationType === 'Open') {
            const openResult = SESOpenNotificationSchema.safeParse(message);
            if (openResult.success) {
              await handleOpen(openResult.data, eventStore);
            }
          } else if (message.notificationType === 'Click') {
            const clickResult = SESClickNotificationSchema.safeParse(message);
            if (clickResult.success) {
              await handleClick(clickResult.data, eventStore);
            }
          }
        }

        return reply.send({ status: 'processed' });
      });
    }
  );

  /**
   * GET /webhooks/email/unsubscribe - Handle one-click unsubscribe
   */
  app.get('/unsubscribe', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('email.handleUnsubscribe', async () => {
      const { token } = request.query as { token?: string };

      if (!token) {
        return reply.status(400).send({ error: 'Missing token' });
      }

      // Redirect to unsubscribe confirmation page
      const webUrl = env.WEB_URL;
      return reply.redirect(`${webUrl}/email/unsubscribed?token=${encodeURIComponent(token)}`);
    });
  });

  /**
   * POST /webhooks/email/unsubscribe - Handle List-Unsubscribe POST
   */
  app.post('/unsubscribe', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('email.handleUnsubscribePost', async () => {
      const body = request.body as { token?: string } | undefined;
      const token = body?.token;

      if (!token) {
        return reply.status(400).send({ error: 'Missing token' });
      }

      // Process unsubscribe
      logger.info(
        { token: token.substring(0, 20) + '...' },
        'Processing unsubscribe request'
      );

      return reply.send({ status: 'unsubscribed' });
    });
  });
}

// Handler functions
async function handleBounce(
  notification: z.infer<typeof SESBounceNotificationSchema>,
  eventStore: ReturnType<typeof getEventStore>
): Promise<void> {
  const { bounce, mail } = notification;

  for (const recipient of bounce.bouncedRecipients) {
    await eventStore.append({
      eventId: nanoid(),
      timestamp: new Date().toISOString(),
      userId: 'system',
      sessionId: 'email',
      turnId: null,
      traceId: mail.messageId,
      type: EventTypes.EMAIL_BOUNCED,
      payload: {
        sesMessageId: mail.messageId,
        bounceType: bounce.bounceType,
        bounceSubType: bounce.bounceSubType,
        recipientEmail: recipient.emailAddress,
        diagnosticCode: recipient.diagnosticCode,
        suppressed: bounce.bounceType === 'Permanent',
        bouncedAt: bounce.timestamp,
      },
      version: '1.0',
      causationId: null,
      correlationId: bounce.feedbackId,
    });

    logger.info(
      {
        messageId: mail.messageId,
        email: recipient.emailAddress,
        bounceType: bounce.bounceType,
      },
      'Bounce recorded'
    );
  }
}

async function handleComplaint(
  notification: z.infer<typeof SESComplaintNotificationSchema>,
  eventStore: ReturnType<typeof getEventStore>
): Promise<void> {
  const { complaint, mail } = notification;

  for (const recipient of complaint.complainedRecipients) {
    await eventStore.append({
      eventId: nanoid(),
      timestamp: new Date().toISOString(),
      userId: 'system',
      sessionId: 'email',
      turnId: null,
      traceId: mail.messageId,
      type: EventTypes.EMAIL_COMPLAINED,
      payload: {
        sesMessageId: mail.messageId,
        recipientEmail: recipient.emailAddress,
        feedbackType: complaint.complaintFeedbackType,
        suppressed: true,
        complainedAt: complaint.timestamp,
      },
      version: '1.0',
      causationId: null,
      correlationId: complaint.feedbackId,
    });

    logger.warn(
      {
        messageId: mail.messageId,
        email: recipient.emailAddress,
      },
      'Complaint recorded - user suppressed'
    );
  }
}

async function handleDelivery(
  notification: z.infer<typeof SESDeliveryNotificationSchema>
): Promise<void> {
  const { delivery, mail } = notification;

  // Update email log with delivery timestamp
  logger.debug(
    {
      messageId: mail.messageId,
      recipients: delivery.recipients,
      processingTime: delivery.processingTimeMillis,
    },
    'Delivery confirmed'
  );
}

async function handleOpen(
  notification: z.infer<typeof SESOpenNotificationSchema>,
  eventStore: ReturnType<typeof getEventStore>
): Promise<void> {
  const { open, mail } = notification;

  await eventStore.append({
    eventId: nanoid(),
    timestamp: new Date().toISOString(),
    userId: 'system',
    sessionId: 'email',
    turnId: null,
    traceId: mail.messageId,
    type: EventTypes.EMAIL_OPENED,
    payload: {
      sesMessageId: mail.messageId,
      recipientEmail: mail.destination[0],
      userAgent: open.userAgent,
      ipAddress: open.ipAddress,
      openedAt: open.timestamp,
    },
    version: '1.0',
    causationId: null,
    correlationId: mail.messageId,
  });

  logger.debug({ messageId: mail.messageId }, 'Email opened');
}

async function handleClick(
  notification: z.infer<typeof SESClickNotificationSchema>,
  eventStore: ReturnType<typeof getEventStore>
): Promise<void> {
  const { click, mail } = notification;

  await eventStore.append({
    eventId: nanoid(),
    timestamp: new Date().toISOString(),
    userId: 'system',
    sessionId: 'email',
    turnId: null,
    traceId: mail.messageId,
    type: EventTypes.EMAIL_CLICKED,
    payload: {
      sesMessageId: mail.messageId,
      recipientEmail: mail.destination[0],
      link: click.link,
      linkTag: click.linkTags ? Object.keys(click.linkTags)[0] : undefined,
      clickedAt: click.timestamp,
    },
    version: '1.0',
    causationId: null,
    correlationId: mail.messageId,
  });

  logger.debug({ messageId: mail.messageId, link: click.link }, 'Email link clicked');
}
