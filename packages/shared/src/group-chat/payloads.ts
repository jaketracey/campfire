/**
 * Group Chat Event Payloads
 * Event payloads for group chat WebSocket messages.
 */

import type { GroupParticipant, LeaveReason, InvitationContext } from './types.js';

/**
 * Payload when a companion is invited to join the session
 */
export interface CompanionInvitedPayload {
  sessionId: string;
  companionId: string;
  companionName: string;
  avatarUrl: string | null;
  invitedByCompanionId: string;
  invitedByCompanionName: string;
  reason?: string;
}

/**
 * Payload when a companion joins the session
 */
export interface CompanionJoinedPayload {
  sessionId: string;
  companionId: string;
  companionName: string;
  avatarUrl: string | null;
  themeColor: string;
  participants: GroupParticipant[];
  invitationContext?: InvitationContext;
}

/**
 * Payload when a companion leaves the session
 */
export interface CompanionLeftPayload {
  sessionId: string;
  companionId: string;
  companionName: string;
  reason: LeaveReason;
  participants: GroupParticipant[];
}

/**
 * Payload when a companion starts speaking
 */
export interface CompanionMessageStartPayload {
  sessionId: string;
  turnId: string;
  companionId: string;
  companionName: string;
  themeColor: string;
  isReaction: boolean;
}

/**
 * Payload for streaming companion message chunks
 */
export interface CompanionMessageChunkPayload {
  sessionId: string;
  turnId: string;
  companionId: string;
  chunk: string;
  isReaction: boolean;
}

/**
 * Payload when a companion finishes speaking
 */
export interface CompanionMessageEndPayload {
  sessionId: string;
  turnId: string;
  companionId: string;
  companionName: string;
  fullMessage: string;
  isReaction: boolean;
  metrics?: {
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Client request to invite a companion
 */
export interface InviteCompanionRequest {
  friendCompanionId: string;
  reason?: string;
}

/**
 * Client request to dismiss a companion
 */
export interface DismissCompanionRequest {
  companionId: string;
}

/**
 * Group chat state update payload
 */
export interface GroupChatStateUpdatePayload {
  sessionId: string;
  isGroupChat: boolean;
  hostCompanionId: string;
  hostCompanionName: string;
  participants: GroupParticipant[];
}
