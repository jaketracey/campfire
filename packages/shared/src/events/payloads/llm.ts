import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * LLM message role
 */
export const LlmRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type LlmRole = z.infer<typeof LlmRoleSchema>;

/**
 * LLM message in the context window
 */
export const LlmContextMessageSchema = z.object({
  role: LlmRoleSchema,
  content: z.string(),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
});

export type LlmContextMessage = z.infer<typeof LlmContextMessageSchema>;

/**
 * Tool definition for LLM
 */
export const LlmToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z.record(z.unknown()),
});

export type LlmToolDefinition = z.infer<typeof LlmToolDefinitionSchema>;

// ============================================================================
// llm.requested
// ============================================================================

export const LlmRequestedPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** Provider (e.g., 'openai', 'anthropic') */
  provider: z.string().min(1),
  /** Model identifier */
  model: z.string().min(1),
  /** Prompt template version for replayability */
  promptVersion: z.string().min(1),
  /** Safety policy version applied */
  safetyPolicyVersion: z.string().min(1),
  /** Number of messages in context */
  contextMessageCount: z.number().int().nonnegative(),
  /** Total tokens in context (estimated) */
  contextTokensEstimate: z.number().int().nonnegative(),
  /** Tools available for this request */
  toolsAvailable: z.array(z.string()),
  /** Temperature setting */
  temperature: z.number().min(0).max(2).optional(),
  /** Max tokens to generate */
  maxTokens: z.number().int().positive().optional(),
  /** Companion ID generating the response */
  companionId: z.string().min(1),
});

export type LlmRequestedPayload = z.infer<typeof LlmRequestedPayloadSchema>;

export const LlmRequestedEventSchema = createEventSchema(
  EventTypes.LLM_REQUESTED,
  LlmRequestedPayloadSchema
);

export type LlmRequestedEvent = TypedEvent<
  typeof EventTypes.LLM_REQUESTED,
  LlmRequestedPayload
>;

// ============================================================================
// llm.token
// ============================================================================

export const LlmTokenPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** Token text */
  token: z.string(),
  /** Sequence index of this token */
  index: z.number().int().nonnegative(),
  /** Cumulative text so far */
  cumulativeText: z.string(),
  /** Finish reason if this is the last token */
  finishReason: z.enum(['stop', 'length', 'tool_calls', 'content_filter']).nullable(),
});

export type LlmTokenPayload = z.infer<typeof LlmTokenPayloadSchema>;

export const LlmTokenEventSchema = createEventSchema(
  EventTypes.LLM_TOKEN,
  LlmTokenPayloadSchema
);

export type LlmTokenEvent = TypedEvent<
  typeof EventTypes.LLM_TOKEN,
  LlmTokenPayload
>;

// ============================================================================
// llm.final
// ============================================================================

export const LlmToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
});

export type LlmToolCall = z.infer<typeof LlmToolCallSchema>;

export const LlmFinalPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** Complete generated text */
  text: z.string(),
  /** Finish reason */
  finishReason: z.enum(['stop', 'length', 'tool_calls', 'content_filter']),
  /** Tool calls if any */
  toolCalls: z.array(LlmToolCallSchema).optional(),
  /** Input tokens used */
  inputTokens: z.number().int().nonnegative(),
  /** Output tokens generated */
  outputTokens: z.number().int().nonnegative(),
  /** Total latency in milliseconds */
  latencyMs: z.number().int().nonnegative(),
  /** Time to first token in milliseconds */
  timeToFirstTokenMs: z.number().int().nonnegative().optional(),
  /** Provider used */
  provider: z.string().min(1),
  /** Model used */
  model: z.string().min(1),
});

export type LlmFinalPayload = z.infer<typeof LlmFinalPayloadSchema>;

export const LlmFinalEventSchema = createEventSchema(
  EventTypes.LLM_FINAL,
  LlmFinalPayloadSchema
);

export type LlmFinalEvent = TypedEvent<
  typeof EventTypes.LLM_FINAL,
  LlmFinalPayload
>;

// ============================================================================
// llm.failed
// ============================================================================

export const LlmFailedPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** Error code */
  errorCode: z.string().min(1),
  /** Error message */
  errorMessage: z.string().min(1),
  /** Whether this error is retryable */
  retryable: z.boolean(),
  /** Retry attempt number (0 for first attempt) */
  attemptNumber: z.number().int().nonnegative(),
  /** Provider used */
  provider: z.string().min(1),
  /** Model used */
  model: z.string().min(1),
  /** HTTP status code if applicable */
  httpStatusCode: z.number().int().optional(),
});

export type LlmFailedPayload = z.infer<typeof LlmFailedPayloadSchema>;

export const LlmFailedEventSchema = createEventSchema(
  EventTypes.LLM_FAILED,
  LlmFailedPayloadSchema
);

export type LlmFailedEvent = TypedEvent<
  typeof EventTypes.LLM_FAILED,
  LlmFailedPayload
>;
