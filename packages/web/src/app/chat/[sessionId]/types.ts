import type { EmotionalState } from '@/lib/api/imagegen';
import type { SignupTrigger } from '@/components/demo/signup-modal';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  emotionalState?: EmotionalState;
  // Group chat fields
  companionId?: string;
  companionName?: string;
  themeColor?: string;
  isReaction?: boolean;
  // Animation control
  isNew?: boolean;
}

// Segment type for parsed message content
export interface MessageSegment {
  type: 'action' | 'dialogue';
  content: string;
}

// Chat event for join/leave notifications
export interface ChatEvent {
  id: string;
  type: 'companion_joined' | 'companion_left';
  companionId: string;
  companionName: string;
  avatarUrl: string | null;
  themeColor: string;
  reason?: string;
  invitedByName?: string;
  timestamp: Date;
}

/** Demo companion data passed from demo page */
export interface DemoCompanionData {
  id: string;
  name: string;
  avatarUrl: string | null;
  archetype: string | null;
  description: string | null;
}

export interface ChatSessionContentProps {
  sessionId: string;
  /** Enable demo mode for anonymous users */
  isDemo?: boolean;
  /** Device fingerprint for anonymous auth (required when isDemo=true) */
  demoFingerprint?: string;
  /** Demo companion data (required when isDemo=true) */
  demoCompanion?: DemoCompanionData;
  /** Callback when message limit reached (demo mode only) */
  onLimitReached?: () => void;
  /** Callback when user tries to access a feature requiring auth (demo mode only) */
  onRequireAuth?: (trigger: SignupTrigger) => void;
}
