import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

// ============================================================================
// tool.called
// ============================================================================

export const ToolCalledPayloadSchema = z.object({
  /** Unique tool call ID */
  toolCallId: z.string().min(1),
  /** Tool name */
  toolName: z.string().min(1),
  /** Tool arguments as JSON string */
  arguments: z.string(),
  /** Parsed arguments for easier access */
  parsedArguments: z.record(z.unknown()).optional(),
  /** Reference to llm.final event that triggered this call */
  llmEventId: z.string().min(1),
  /** Tool version */
  toolVersion: z.string().optional(),
});

export type ToolCalledPayload = z.infer<typeof ToolCalledPayloadSchema>;

export const ToolCalledEventSchema = createEventSchema(
  EventTypes.TOOL_CALLED,
  ToolCalledPayloadSchema
);

export type ToolCalledEvent = TypedEvent<
  typeof EventTypes.TOOL_CALLED,
  ToolCalledPayload
>;

// ============================================================================
// tool.succeeded
// ============================================================================

export const ToolSucceededPayloadSchema = z.object({
  /** Tool call ID for correlation */
  toolCallId: z.string().min(1),
  /** Tool name */
  toolName: z.string().min(1),
  /** Tool result as JSON string */
  result: z.string(),
  /** Execution duration in milliseconds */
  durationMs: z.number().int().nonnegative(),
  /** Any side effects produced (e.g., event IDs of memory writes) */
  sideEffectEventIds: z.array(z.string()).optional(),
});

export type ToolSucceededPayload = z.infer<typeof ToolSucceededPayloadSchema>;

export const ToolSucceededEventSchema = createEventSchema(
  EventTypes.TOOL_SUCCEEDED,
  ToolSucceededPayloadSchema
);

export type ToolSucceededEvent = TypedEvent<
  typeof EventTypes.TOOL_SUCCEEDED,
  ToolSucceededPayload
>;

// ============================================================================
// tool.failed
// ============================================================================

export const ToolFailedPayloadSchema = z.object({
  /** Tool call ID for correlation */
  toolCallId: z.string().min(1),
  /** Tool name */
  toolName: z.string().min(1),
  /** Stable error code for categorization */
  errorCode: z.string().min(1),
  /** Human-readable error message */
  errorMessage: z.string().min(1),
  /** Execution duration in milliseconds */
  durationMs: z.number().int().nonnegative(),
  /** Whether this error is retryable */
  retryable: z.boolean(),
  /** Stack trace if available (sanitized) */
  stackTrace: z.string().optional(),
});

export type ToolFailedPayload = z.infer<typeof ToolFailedPayloadSchema>;

export const ToolFailedEventSchema = createEventSchema(
  EventTypes.TOOL_FAILED,
  ToolFailedPayloadSchema
);

export type ToolFailedEvent = TypedEvent<
  typeof EventTypes.TOOL_FAILED,
  ToolFailedPayload
>;
