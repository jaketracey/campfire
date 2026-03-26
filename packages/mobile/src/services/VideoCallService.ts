import { AppState, AppStateStatus, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const AUTH_STORAGE_KEY = 'campfire_auth';

/**
 * Connection states for the video call lifecycle
 */
export type VideoCallStatus =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnecting'
  | 'ended'
  | 'error';

/**
 * Network quality levels for UI indicators
 */
export type NetworkQuality = 'excellent' | 'good' | 'poor' | 'unknown';

export interface VideoCallRoom {
  id: string;
  roomUrl: string;
  token: string;
  companionId: string;
  companionName: string;
  companionAvatarUrl?: string;
  costPerMinute: number;
}

export interface VideoCallState {
  status: VideoCallStatus;
  room: VideoCallRoom | null;
  error: string | null;
  isMicMuted: boolean;
  isCameraEnabled: boolean;
  isSpeakerOn: boolean;
  networkQuality: NetworkQuality;
  startedAt: number | null;
}

export type VideoCallListener = (state: VideoCallState) => void;

/**
 * VideoCallService manages the full lifecycle of a video call with an AI companion.
 *
 * It handles:
 * - API calls to start/end video calls
 * - LiveKit room connection via the @livekit/react-native SDK
 * - Mic/camera/speaker toggling
 * - App state transitions (background/foreground)
 * - Reconnection on network changes
 * - Clean teardown
 *
 * This service is consumed by the useVideoCall hook and should not be used
 * directly by components.
 */
class VideoCallService {
  private state: VideoCallState = {
    status: 'idle',
    room: null,
    error: null,
    isMicMuted: false,
    isCameraEnabled: false,
    isSpeakerOn: true,
    networkQuality: 'unknown',
    startedAt: null,
  };

  private listeners: Set<VideoCallListener> = new Set();
  private livekitRoom: any = null;
  private appStateSubscription: { remove: () => void } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private gatewayBaseUrl: string;

  constructor() {
    // The gateway URL should come from app config; we read it lazily in methods.
    // Using a sensible default that can be overridden.
    this.gatewayBaseUrl = '';
  }

  // ---- Public API ----

  /**
   * Set the gateway base URL (called once during app initialization)
   */
  setGatewayUrl(url: string): void {
    this.gatewayBaseUrl = url.replace(/\/$/, '');
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: VideoCallListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get current state snapshot
   */
  getState(): VideoCallState {
    return { ...this.state };
  }

  /**
   * Start a video call with a companion.
   *
   * 1. POST to gateway to create a room and get a LiveKit token
   * 2. Connect to the LiveKit room
   * 3. Begin monitoring app state and network quality
   */
  async startCall(companionId: string): Promise<void> {
    if (this.state.status !== 'idle' && this.state.status !== 'ended' && this.state.status !== 'error') {
      console.warn('[VideoCall] Cannot start call in status:', this.state.status);
      return;
    }

    this.updateState({ status: 'requesting', error: null });

    try {
      const authToken = await this.getAuthToken();
      if (!authToken) {
        throw new Error('Not authenticated. Please sign in first.');
      }

      // 1. Request a room from the gateway
      const response = await fetch(`${this.gatewayBaseUrl}/api/v1/video-calls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ companionId }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `Failed to create video call (${response.status})`);
      }

      const roomData: VideoCallRoom = await response.json();

      this.updateState({
        status: 'connecting',
        room: roomData,
      });

      // 2. Connect to LiveKit
      await this.connectToLiveKit(roomData);

      // 3. Set up background/foreground monitoring
      this.startAppStateMonitoring();

      this.updateState({
        status: 'connected',
        startedAt: Date.now(),
      });

      console.log('[VideoCall] Connected to room:', roomData.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start call';
      console.error('[VideoCall] Start error:', message);
      this.updateState({
        status: 'error',
        error: message,
      });
      await this.cleanup();
    }
  }

  /**
   * End the current video call.
   *
   * 1. POST to gateway to mark the call as ended
   * 2. Disconnect from LiveKit
   * 3. Clean up all resources
   */
  async endCall(): Promise<{ durationSeconds: number; tokensUsed: number } | null> {
    const roomId = this.state.room?.id;
    if (!roomId) {
      console.warn('[VideoCall] No active call to end');
      this.updateState({ status: 'idle' });
      return null;
    }

    this.updateState({ status: 'disconnecting' });

    let summary: { durationSeconds: number; tokensUsed: number } | null = null;

    try {
      const authToken = await this.getAuthToken();
      if (authToken) {
        const response = await fetch(`${this.gatewayBaseUrl}/api/v1/video-calls/${roomId}/end`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          summary = {
            durationSeconds: data.durationSeconds || 0,
            tokensUsed: data.tokensUsed || 0,
          };
        }
      }
    } catch (error) {
      console.error('[VideoCall] End call API error:', error);
      // Continue with cleanup even if the API call fails
    }

    await this.cleanup();
    this.updateState({ status: 'ended' });

    return summary;
  }

  /**
   * Toggle microphone mute
   */
  async toggleMic(): Promise<void> {
    const newMuted = !this.state.isMicMuted;

    try {
      if (this.livekitRoom) {
        const localParticipant = this.livekitRoom.localParticipant;
        if (localParticipant) {
          await localParticipant.setMicrophoneEnabled(!newMuted);
        }
      }
      this.updateState({ isMicMuted: newMuted });
    } catch (error) {
      console.error('[VideoCall] Toggle mic error:', error);
    }
  }

  /**
   * Toggle local camera
   */
  async toggleCamera(): Promise<void> {
    const newEnabled = !this.state.isCameraEnabled;

    try {
      if (this.livekitRoom) {
        const localParticipant = this.livekitRoom.localParticipant;
        if (localParticipant) {
          await localParticipant.setCameraEnabled(newEnabled);
        }
      }
      this.updateState({ isCameraEnabled: newEnabled });
    } catch (error) {
      console.error('[VideoCall] Toggle camera error:', error);
    }
  }

  /**
   * Toggle speaker / earpiece routing
   */
  toggleSpeaker(): void {
    const newSpeakerOn = !this.state.isSpeakerOn;
    this.updateState({ isSpeakerOn: newSpeakerOn });

    // Audio routing is handled at the React Native Audio level.
    // In a real implementation this would call into expo-av or a native module
    // to switch between speaker and earpiece.
    console.log('[VideoCall] Speaker:', newSpeakerOn ? 'on' : 'off');
  }

  /**
   * Reset the service to idle (for navigating away from the ended screen)
   */
  reset(): void {
    this.updateState({
      status: 'idle',
      room: null,
      error: null,
      isMicMuted: false,
      isCameraEnabled: false,
      isSpeakerOn: true,
      networkQuality: 'unknown',
      startedAt: null,
    });
  }

  // ---- Private helpers ----

  private async getAuthToken(): Promise<string | null> {
    try {
      const stored = await SecureStore.getItemAsync(AUTH_STORAGE_KEY);
      if (stored) {
        const auth = JSON.parse(stored);
        return auth.accessToken || null;
      }
    } catch (error) {
      console.error('[VideoCall] Auth token read error:', error);
    }
    return null;
  }

  /**
   * Connect to a LiveKit room.
   *
   * This dynamically imports @livekit/react-native so that the rest of the
   * app can load even if the native module is not yet linked (e.g. in Expo Go
   * during development). In production the module must be available.
   */
  private async connectToLiveKit(roomData: VideoCallRoom): Promise<void> {
    try {
      // Dynamic import so the app doesn't crash if LiveKit native module
      // is not linked yet (dev/testing scenarios).
      const LiveKit = await import('@livekit/react-native');
      const { Room, RoomEvent } = LiveKit;

      const room = new Room();

      // Listen for connection quality changes
      room.on(RoomEvent.ConnectionQualityChanged, (_quality: string) => {
        this.updateState({
          networkQuality: this.mapLiveKitQuality(_quality),
        });
      });

      // Listen for disconnection
      room.on(RoomEvent.Disconnected, () => {
        console.log('[VideoCall] Disconnected from room');
        if (this.state.status === 'connected') {
          this.handleDisconnect();
        }
      });

      // Listen for reconnection events
      room.on(RoomEvent.Reconnecting, () => {
        console.log('[VideoCall] Reconnecting...');
        this.updateState({ status: 'reconnecting' });
      });

      room.on(RoomEvent.Reconnected, () => {
        console.log('[VideoCall] Reconnected');
        this.updateState({ status: 'connected' });
      });

      // Connect
      await room.connect(roomData.roomUrl, roomData.token);

      // Enable microphone by default, camera off by default
      await room.localParticipant.setMicrophoneEnabled(true);

      this.livekitRoom = room;
    } catch (error) {
      console.error('[VideoCall] LiveKit connect error:', error);
      throw new Error('Failed to connect to video room. Please try again.');
    }
  }

  private mapLiveKitQuality(quality: string): NetworkQuality {
    switch (quality) {
      case 'excellent':
        return 'excellent';
      case 'good':
        return 'good';
      case 'poor':
      case 'lost':
        return 'poor';
      default:
        return 'unknown';
    }
  }

  /**
   * Handle unexpected disconnect -- attempt reconnection
   */
  private handleDisconnect(): void {
    this.updateState({ status: 'reconnecting' });

    // Give LiveKit's built-in reconnect a chance, then give up after 15 seconds
    this.reconnectTimer = setTimeout(() => {
      if (this.state.status === 'reconnecting') {
        console.log('[VideoCall] Reconnect timed out');
        this.updateState({
          status: 'error',
          error: 'Connection lost. Please try again.',
        });
        this.cleanup();
      }
    }, 15_000);
  }

  /**
   * Pause video when app goes to background, resume on foreground
   */
  private startAppStateMonitoring(): void {
    this.appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (!this.livekitRoom) return;

      const localParticipant = this.livekitRoom.localParticipant;
      if (!localParticipant) return;

      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // Pause camera when backgrounded to save battery
        localParticipant.setCameraEnabled(false).catch(() => {});
        console.log('[VideoCall] Backgrounded -- camera paused');
      } else if (nextAppState === 'active') {
        // Restore camera state if it was enabled before backgrounding
        if (this.state.isCameraEnabled) {
          localParticipant.setCameraEnabled(true).catch(() => {});
          console.log('[VideoCall] Foregrounded -- camera restored');
        }
      }
    });
  }

  /**
   * Clean up all resources
   */
  private async cleanup(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    if (this.livekitRoom) {
      try {
        await this.livekitRoom.disconnect();
      } catch (error) {
        console.error('[VideoCall] Disconnect error:', error);
      }
      this.livekitRoom = null;
    }
  }

  private updateState(partial: Partial<VideoCallState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        console.error('[VideoCall] Listener error:', error);
      }
    }
  }
}

// Export singleton instance
export const videoCallService = new VideoCallService();
