/**
 * Message types for WebView <-> Native communication
 */
export type BridgeMessageType =
  | 'AUTH_SYNC'
  | 'AUDIO_RECORD_START'
  | 'AUDIO_RECORD_STOP'
  | 'AUDIO_RECORD_COMPLETE'
  | 'AUDIO_PLAY'
  | 'AUDIO_STOP'
  | 'AUDIO_PLAYBACK_COMPLETE'
  | 'PUSH_TOKEN'
  | 'NAVIGATE'
  | 'GOOGLE_AUTH_REQUEST';

export interface BridgeMessage<T = unknown> {
  type: BridgeMessageType;
  payload?: T;
}

/**
 * Auth sync payload
 */
export interface AuthSyncPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user?: {
    id: string;
    email: string;
    displayName?: string;
  };
}

/**
 * Audio recording complete payload
 */
export interface AudioRecordCompletePayload {
  /** Base64 encoded 16-bit PCM audio data */
  audioData: string;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Audio play payload
 */
export interface AudioPlayPayload {
  /** Base64 encoded MP3 audio data */
  data: string;
}

/**
 * Push token payload
 */
export interface PushTokenPayload {
  token: string;
  platform: 'ios' | 'android';
}

/**
 * Navigation payload
 */
export interface NavigatePayload {
  path: string;
}

/**
 * Google auth request payload
 */
export interface GoogleAuthRequestPayload {
  mode: 'signin' | 'signup';
}

/**
 * Google auth result (for injecting back to web)
 */
export interface GoogleAuthResult {
  idToken: string;
  mode: 'signin' | 'signup';
}

/**
 * Type guard for bridge messages
 */
export function isBridgeMessage(data: unknown): data is BridgeMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as BridgeMessage).type === 'string'
  );
}

/**
 * Parse a message from the WebView
 */
export function parseBridgeMessage(event: { nativeEvent: { data: string } }): BridgeMessage | null {
  try {
    const data = JSON.parse(event.nativeEvent.data);
    if (isBridgeMessage(data)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}
