import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * Cost category
 */
export const CostCategorySchema = z.enum([
  'llm',        // LLM inference
  'stt',        // Speech-to-text
  'tts',        // Text-to-speech
  'imagegen',   // Image generation
  'embedding',  // Embedding generation
  'storage',    // Storage costs
  'compute',    // General compute
]);

export type CostCategory = z.infer<typeof CostCategorySchema>;

/**
 * Individual cost line item
 */
export const CostLineItemSchema = z.object({
  /** Category of cost */
  category: CostCategorySchema,
  /** Provider (e.g., 'openai', 'anthropic', 'elevenlabs') */
  provider: z.string().min(1),
  /** Model or service */
  model: z.string().min(1),
  /** Quantity (tokens, seconds, bytes, etc.) */
  quantity: z.number().nonnegative(),
  /** Unit of quantity */
  unit: z.enum(['tokens', 'characters', 'seconds', 'bytes', 'images', 'requests']),
  /** Cost in USD */
  costUsd: z.number().nonnegative(),
  /** Reference event ID */
  referenceEventId: z.string().min(1),
});

export type CostLineItem = z.infer<typeof CostLineItemSchema>;

// ============================================================================
// cost.recorded
// ============================================================================

export const CostRecordedPayloadSchema = z.object({
  /** Cost record ID */
  costId: z.string().min(1),
  /** Line items */
  lineItems: z.array(CostLineItemSchema).min(1),
  /** Total cost in USD */
  totalCostUsd: z.number().nonnegative(),
  /** Turn-level aggregation */
  turnTotalUsd: z.number().nonnegative().optional(),
  /** Session-level aggregation (running total) */
  sessionTotalUsd: z.number().nonnegative().optional(),
  /** Billing period (e.g., '2024-01') */
  billingPeriod: z.string().min(1),
  /** ISO8601 timestamp of recording */
  recordedAt: z.string().datetime({ offset: true }),
});

export type CostRecordedPayload = z.infer<typeof CostRecordedPayloadSchema>;

export const CostRecordedEventSchema = createEventSchema(
  EventTypes.COST_RECORDED,
  CostRecordedPayloadSchema
);

export type CostRecordedEvent = TypedEvent<
  typeof EventTypes.COST_RECORDED,
  CostRecordedPayload
>;
