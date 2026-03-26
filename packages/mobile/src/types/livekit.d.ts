/**
 * Type declarations for @livekit/react-native
 *
 * These are minimal declarations to satisfy the TypeScript compiler until
 * the package is installed and provides its own types. Once `npm install`
 * is run with the LiveKit packages, this file can be removed.
 */
declare module '@livekit/react-native' {
  export class Room {
    localParticipant: {
      setMicrophoneEnabled(enabled: boolean): Promise<void>;
      setCameraEnabled(enabled: boolean): Promise<void>;
    };
    connect(url: string, token: string): Promise<void>;
    disconnect(): Promise<void>;
    on(event: string, callback: (...args: any[]) => void): void;
    off(event: string, callback: (...args: any[]) => void): void;
  }

  export const RoomEvent: {
    ConnectionQualityChanged: string;
    Disconnected: string;
    Reconnecting: string;
    Reconnected: string;
    TrackSubscribed: string;
    TrackUnsubscribed: string;
  };
}

declare module '@livekit/react-native-webrtc' {
  // Re-exported WebRTC primitives; no direct usage in our code
}
