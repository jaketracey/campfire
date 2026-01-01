import { z } from 'zod';

/**
 * Standard API error response
 */
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  traceId: z.string().optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Standard API success response wrapper
 */
export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: z.object({
      requestId: z.string(),
      timestamp: z.string().datetime({ offset: true }),
    }).optional(),
  });

/**
 * Paginated response wrapper
 */
export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    success: z.literal(true),
    data: z.object({
      items: z.array(itemSchema),
      pagination: z.object({
        page: z.number().int().min(1),
        pageSize: z.number().int().min(1).max(100),
        totalItems: z.number().int().min(0),
        totalPages: z.number().int().min(0),
        hasNext: z.boolean(),
        hasPrev: z.boolean(),
      }),
    }),
  });

/**
 * Authentication tokens
 */
export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  tokenType: z.literal('Bearer'),
});

export type AuthTokens = z.infer<typeof AuthTokensSchema>;

/**
 * User profile
 */
export const UserProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

/**
 * Session information
 */
export const SessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  companionId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  turnCount: z.number().int().min(0),
  status: z.enum(['active', 'ended', 'expired']),
});

export type Session = z.infer<typeof SessionSchema>;

/**
 * Memory entry from vector store
 */
export const MemoryEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  companionId: z.string().uuid().optional(),
  content: z.string(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime({ offset: true }),
  score: z.number().min(0).max(1).optional(),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

/**
 * Vault entry (encrypted user data)
 */
export const VaultEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  key: z.string().min(1).max(255),
  encryptedValue: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type VaultEntry = z.infer<typeof VaultEntrySchema>;

/**
 * Knowledge graph node
 */
export const KGNodeSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  label: z.string().min(1),
  type: z.string().min(1),
  properties: z.record(z.unknown()),
  createdAt: z.string().datetime({ offset: true }),
});

export type KGNode = z.infer<typeof KGNodeSchema>;

/**
 * Knowledge graph edge
 */
export const KGEdgeSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  relationship: z.string().min(1),
  properties: z.record(z.unknown()),
  createdAt: z.string().datetime({ offset: true }),
});

export type KGEdge = z.infer<typeof KGEdgeSchema>;

/**
 * Knowledge graph query result
 */
export const KGQueryResultSchema = z.object({
  nodes: z.array(KGNodeSchema),
  edges: z.array(KGEdgeSchema),
});

export type KGQueryResult = z.infer<typeof KGQueryResultSchema>;

/**
 * WebSocket message types
 */
export const WSMessageTypeSchema = z.enum([
  'audio.chunk',
  'audio.end',
  'transcript.partial',
  'transcript.final',
  'response.start',
  'response.chunk',
  'response.end',
  'tts.start',
  'tts.chunk',
  'tts.end',
  'session.start',
  'session.end',
  'error',
  'ping',
  'pong',
]);

export type WSMessageType = z.infer<typeof WSMessageTypeSchema>;

/**
 * Base WebSocket message
 */
export const WSMessageSchema = z.object({
  type: WSMessageTypeSchema,
  sessionId: z.string().uuid(),
  turnId: z.string().uuid().optional(),
  timestamp: z.string().datetime({ offset: true }),
  payload: z.unknown(),
});

export type WSMessage = z.infer<typeof WSMessageSchema>;

/**
 * Audio chunk message payload
 */
export const AudioChunkPayloadSchema = z.object({
  /** Base64 encoded audio data */
  data: z.string(),
  /** Audio format (e.g., 'pcm16', 'opus') */
  format: z.enum(['pcm16', 'opus', 'mp3', 'wav']),
  /** Sample rate in Hz */
  sampleRate: z.number().int().min(8000).max(48000),
  /** Sequence number for ordering */
  sequence: z.number().int().min(0),
  /** Whether this is the final chunk */
  isFinal: z.boolean().default(false),
});

export type AudioChunkPayload = z.infer<typeof AudioChunkPayloadSchema>;

/**
 * Transcript message payload
 */
export const TranscriptPayloadSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  isFinal: z.boolean(),
  language: z.string().optional(),
});

export type TranscriptPayload = z.infer<typeof TranscriptPayloadSchema>;

/**
 * Error message payload
 */
export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(false),
});

export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
