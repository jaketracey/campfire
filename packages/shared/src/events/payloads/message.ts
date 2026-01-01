import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * Message content types
 */
export const MessageContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal('image'),
    imageUrl: z.string().url(),
    altText: z.string().optional(),
    mimeType: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('audio'),
    audioUrl: z.string().url(),
    durationMs: z.number().int().nonnegative(),
    transcript: z.string().optional(),
  }),
]);

export type MessageContent = z.infer<typeof MessageContentSchema>;

/**
 * Input modality for the message
 */
export const InputModalitySchema = z.enum(['voice', 'text', 'image']);
export type InputModality = z.infer<typeof InputModalitySchema>;

// ============================================================================
// user.message.created
// ============================================================================

export const UserMessageCreatedPayloadSchema = z.object({
  /** Unique message ID */
  messageId: z.string().min(1),
  /** Message content (can be multimodal) */
  content: z.array(MessageContentSchema).min(1),
  /** Primary input modality */
  inputModality: InputModalitySchema,
  /** Reference to stt.final event if voice input */
  sttEventId: z.string().optional(),
  /** ISO8601 timestamp of message creation */
  createdAt: z.string().datetime({ offset: true }),
});

export type UserMessageCreatedPayload = z.infer<typeof UserMessageCreatedPayloadSchema>;

export const UserMessageCreatedEventSchema = createEventSchema(
  EventTypes.USER_MESSAGE_CREATED,
  UserMessageCreatedPayloadSchema
);

export type UserMessageCreatedEvent = TypedEvent<
  typeof EventTypes.USER_MESSAGE_CREATED,
  UserMessageCreatedPayload
>;

// ============================================================================
// agent.message.created
// ============================================================================

export const AgentMessageCreatedPayloadSchema = z.object({
  /** Unique message ID */
  messageId: z.string().min(1),
  /** Message content (can be multimodal) */
  content: z.array(MessageContentSchema).min(1),
  /** Reference to llm.final event */
  llmEventId: z.string().min(1),
  /** Reference to tts.completed event if voice output */
  ttsEventId: z.string().optional(),
  /** References to any generated images */
  imageEventIds: z.array(z.string()).optional(),
  /** Companion ID that generated this message */
  companionId: z.string().min(1),
  /** ISO8601 timestamp of message creation */
  createdAt: z.string().datetime({ offset: true }),
  /** Emotion/mood tag for avatar updates */
  emotionTag: z.string().optional(),
});

export type AgentMessageCreatedPayload = z.infer<typeof AgentMessageCreatedPayloadSchema>;

export const AgentMessageCreatedEventSchema = createEventSchema(
  EventTypes.AGENT_MESSAGE_CREATED,
  AgentMessageCreatedPayloadSchema
);

export type AgentMessageCreatedEvent = TypedEvent<
  typeof EventTypes.AGENT_MESSAGE_CREATED,
  AgentMessageCreatedPayload
>;
