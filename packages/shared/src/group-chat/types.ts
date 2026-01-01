/**
 * Group Chat Types
 * Types for multi-companion group chat sessions.
 */

/**
 * Participant role in a group chat session
 */
export type ParticipantRole = 'primary' | 'invited';

/**
 * Participant status in a group chat session
 */
export type ParticipantStatus = 'active' | 'left';

/**
 * Reason a companion left the group chat
 */
export type LeaveReason = 'dismissed' | 'left' | 'archived' | 'error';

/**
 * A participant in a group chat session
 */
export interface GroupParticipant {
  companionId: string;
  companionName: string;
  avatarUrl: string | null;
  role: ParticipantRole;
  themeColor: string;
  joinedAt: string;
  messageCount: number;
}

/**
 * State of a group chat session
 */
export interface GroupChatState {
  isGroupChat: boolean;
  hostCompanionId: string;
  hostCompanionName: string;
  participants: GroupParticipant[];
}

/**
 * A message in a group chat
 */
export interface GroupMessage {
  id: string;
  speakerId: string;
  speakerType: 'user' | 'companion';
  speakerName: string;
  themeColor?: string;
  content: string;
  createdAt: string;
  isReaction: boolean;
}

/**
 * A turn in a group chat (user message + companion responses)
 */
export interface GroupConversationTurn {
  turnNumber: number;
  userMessage: {
    content: string;
    createdAt: string;
  };
  companionMessages: GroupMessage[];
}

/**
 * Invitation context for a companion joining
 */
export interface InvitationContext {
  invitedByCompanionId: string;
  invitedByCompanionName: string;
  reason?: string;
}

/**
 * Theme colors for companions in group chat
 * Used to visually distinguish between speakers
 */
export const COMPANION_THEME_COLORS = [
  '#8B5CF6', // violet (primary)
  '#F97316', // orange
  '#10B981', // emerald
  '#EC4899', // pink
  '#3B82F6', // blue
] as const;

/**
 * Get a theme color for a companion based on their position
 */
export function getThemeColor(index: number): string {
  return COMPANION_THEME_COLORS[index % COMPANION_THEME_COLORS.length]!;
}

/**
 * Maximum number of companions allowed in a group chat
 */
export const MAX_GROUP_PARTICIPANTS = 5;
