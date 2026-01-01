import { z } from 'zod';

/**
 * Session event payloads
 */
export const SessionStartedPayloadSchema = z.object({
  companionId: z.string().uuid(),
  metadata: z.record(z.unknown()).optional(),
});

export const SessionEndedPayloadSchema = z.object({
  reason: z.enum(['user_ended', 'timeout', 'error', 'system']),
  turnCount: z.number().int().min(0),
  durationMs: z.number().int().min(0),
});

/**
 * Audio/STT event payloads
 */
export const AudioChunkReceivedPayloadSchema = z.object({
  format: z.enum(['pcm16', 'opus', 'mp3', 'wav']),
  sampleRate: z.number().int(),
  sizeBytes: z.number().int().min(0),
  sequence: z.number().int().min(0),
});

export const STTPartialPayloadSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

export const STTFinalPayloadSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  language: z.string().optional(),
  durationMs: z.number().int().min(0),
});

/**
 * Message event payloads
 */
export const UserMessageCreatedPayloadSchema = z.object({
  content: z.string(),
  inputType: z.enum(['voice', 'text']),
});

export const AgentMessageCreatedPayloadSchema = z.object({
  content: z.string(),
  model: z.string(),
});

/**
 * LLM event payloads
 */
export const LLMRequestedPayloadSchema = z.object({
  provider: z.string(),
  model: z.string(),
  promptTokens: z.number().int().optional(),
});

export const LLMTokenPayloadSchema = z.object({
  token: z.string(),
  index: z.number().int().min(0),
});

export const LLMFinalPayloadSchema = z.object({
  text: z.string(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  stopReason: z.enum(['stop', 'length', 'content_filter', 'error']),
});

export const LLMFailedPayloadSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  retryable: z.boolean(),
});

/**
 * Tool event payloads
 */
export const ToolCalledPayloadSchema = z.object({
  toolName: z.string(),
  input: z.record(z.unknown()),
});

export const ToolSucceededPayloadSchema = z.object({
  toolName: z.string(),
  output: z.unknown(),
  durationMs: z.number().int().min(0),
});

export const ToolFailedPayloadSchema = z.object({
  toolName: z.string(),
  error: z.string(),
  code: z.string().optional(),
});

/**
 * Memory event payloads
 */
export const MemoryProposedPayloadSchema = z.object({
  memoryType: z.enum(['episodic', 'semantic', 'procedural']),
  contentPreview: z.string().max(200),
});

export const MemoryWrittenPayloadSchema = z.object({
  memoryId: z.string().uuid(),
  memoryType: z.enum(['episodic', 'semantic', 'procedural']),
  contentPreview: z.string().max(200),
});

export const MemoryDeletedPayloadSchema = z.object({
  memoryId: z.string().uuid(),
  reason: z.string().optional(),
});

export const MemoryRetrievalRequestedPayloadSchema = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(100),
});

export const MemoryRetrievalCompletedPayloadSchema = z.object({
  query: z.string(),
  resultCount: z.number().int().min(0),
  topScore: z.number().min(0).max(1).optional(),
});

/**
 * Safety event payloads
 */
export const SafetyFlaggedPayloadSchema = z.object({
  input: z.string(),
  category: z.string(),
  score: z.number().min(0).max(1),
  action: z.enum(['allow', 'warn', 'block']),
});

export const SafetyBlockedPayloadSchema = z.object({
  input: z.string(),
  category: z.string(),
  reason: z.string(),
});

export const SafetyEscalatedPayloadSchema = z.object({
  input: z.string(),
  category: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  details: z.record(z.unknown()).optional(),
});

/**
 * TTS event payloads
 */
export const TTSRequestedPayloadSchema = z.object({
  provider: z.string(),
  voiceId: z.string(),
  text: z.string(),
});

export const TTSChunkReadyPayloadSchema = z.object({
  chunkIndex: z.number().int().min(0),
  sizeBytes: z.number().int().min(0),
});

export const TTSCompletedPayloadSchema = z.object({
  durationMs: z.number().int().min(0),
  audioSizeBytes: z.number().int().min(0),
  audioDurationMs: z.number().int().min(0),
});

/**
 * Cost event payloads
 */
export const CostRecordedPayloadSchema = z.object({
  provider: z.string(),
  model: z.string(),
  operation: z.string(),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  durationMs: z.number().int().min(0).optional(),
  estimatedCostUsd: z.number().min(0),
});

/**
 * ImageGen event payloads
 */
export const ImageGenRequestedPayloadSchema = z.object({
  provider: z.string(),
  model: z.string(),
  prompt: z.string(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
});

export const ImageGenGeneratedPayloadSchema = z.object({
  imageId: z.string(),
  url: z.string().url(),
  width: z.number().int(),
  height: z.number().int(),
  durationMs: z.number().int().min(0),
});

export const ImageGenBlockedPayloadSchema = z.object({
  reason: z.string(),
  category: z.string().optional(),
});

/**
 * Error event payload
 */
export const ErrorOccurredPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  component: z.string(),
  recoverable: z.boolean(),
});

/**
 * Inferred payload types
 */
export type SessionStartedPayload = z.infer<typeof SessionStartedPayloadSchema>;
export type SessionEndedPayload = z.infer<typeof SessionEndedPayloadSchema>;
export type AudioChunkReceivedPayload = z.infer<typeof AudioChunkReceivedPayloadSchema>;
export type STTPartialPayload = z.infer<typeof STTPartialPayloadSchema>;
export type STTFinalPayload = z.infer<typeof STTFinalPayloadSchema>;
export type UserMessageCreatedPayload = z.infer<typeof UserMessageCreatedPayloadSchema>;
export type AgentMessageCreatedPayload = z.infer<typeof AgentMessageCreatedPayloadSchema>;
export type LLMRequestedPayload = z.infer<typeof LLMRequestedPayloadSchema>;
export type LLMTokenPayload = z.infer<typeof LLMTokenPayloadSchema>;
export type LLMFinalPayload = z.infer<typeof LLMFinalPayloadSchema>;
export type LLMFailedPayload = z.infer<typeof LLMFailedPayloadSchema>;
export type ToolCalledPayload = z.infer<typeof ToolCalledPayloadSchema>;
export type ToolSucceededPayload = z.infer<typeof ToolSucceededPayloadSchema>;
export type ToolFailedPayload = z.infer<typeof ToolFailedPayloadSchema>;
export type MemoryProposedPayload = z.infer<typeof MemoryProposedPayloadSchema>;
export type MemoryWrittenPayload = z.infer<typeof MemoryWrittenPayloadSchema>;
export type MemoryDeletedPayload = z.infer<typeof MemoryDeletedPayloadSchema>;
export type MemoryRetrievalRequestedPayload = z.infer<typeof MemoryRetrievalRequestedPayloadSchema>;
export type MemoryRetrievalCompletedPayload = z.infer<typeof MemoryRetrievalCompletedPayloadSchema>;
export type SafetyFlaggedPayload = z.infer<typeof SafetyFlaggedPayloadSchema>;
export type SafetyBlockedPayload = z.infer<typeof SafetyBlockedPayloadSchema>;
export type SafetyEscalatedPayload = z.infer<typeof SafetyEscalatedPayloadSchema>;
export type TTSRequestedPayload = z.infer<typeof TTSRequestedPayloadSchema>;
export type TTSChunkReadyPayload = z.infer<typeof TTSChunkReadyPayloadSchema>;
export type TTSCompletedPayload = z.infer<typeof TTSCompletedPayloadSchema>;
export type CostRecordedPayload = z.infer<typeof CostRecordedPayloadSchema>;
export type ImageGenRequestedPayload = z.infer<typeof ImageGenRequestedPayloadSchema>;
export type ImageGenGeneratedPayload = z.infer<typeof ImageGenGeneratedPayloadSchema>;
export type ImageGenBlockedPayload = z.infer<typeof ImageGenBlockedPayloadSchema>;
export type ErrorOccurredPayload = z.infer<typeof ErrorOccurredPayloadSchema>;
