/**
 * Video Call Types
 * Shared type definitions for live video calls with AI companions.
 */

// ============================================================================
// Video Call Status
// ============================================================================

/** Possible states of a video call */
export type VideoCallStatus = 'connecting' | 'active' | 'ending' | 'ended' | 'failed';

/** All valid video call statuses as a const array for runtime validation */
export const VIDEO_CALL_STATUSES = ['connecting', 'active', 'ending', 'ended', 'failed'] as const;

// ============================================================================
// Video Quality
// ============================================================================

/** Video quality levels affecting resolution and bandwidth */
export type VideoQuality = 'low' | 'medium' | 'high';

/** All valid video quality levels */
export const VIDEO_QUALITY_LEVELS = ['low', 'medium', 'high'] as const;

// ============================================================================
// Video Call Session
// ============================================================================

/** Represents a video call record in the database */
export interface VideoCallSession {
  readonly id: string;
  readonly userId: string;
  readonly companionId: string;
  readonly sessionId: string | null;
  readonly roomName: string;
  readonly status: VideoCallStatus;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
  readonly tokensDeducted: number;
  readonly avatarProvider: string;
  readonly avatarFaceId: string | null;
  readonly costUsd: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: string;
}

// ============================================================================
// Video Call Config
// ============================================================================

/** Configuration for starting a video call */
export interface VideoCallConfig {
  readonly companionId: string;
  readonly avatarFaceId?: string | undefined;
  readonly videoQuality: VideoQuality;
}

// ============================================================================
// Request / Response Types
// ============================================================================

/** Request body to create a new video call */
export interface CreateVideoCallRequest {
  readonly companionId: string;
  readonly sessionId?: string | undefined;
  readonly avatarFaceId?: string | undefined;
  readonly videoQuality?: VideoQuality | undefined;
}

/** Response returned when a video call is created */
export interface CreateVideoCallResponse {
  readonly videoCallId: string;
  readonly roomName: string;
  readonly roomUrl: string;
  readonly token: string;
  readonly status: VideoCallStatus;
}

// ============================================================================
// Video Call Billing
// ============================================================================

/** Tokens deducted per second for video calls (2x voice rate) */
export const VIDEO_CALL_TOKENS_PER_SECOND = 2;

/** Default avatar provider */
export const DEFAULT_AVATAR_PROVIDER = 'simli';
