import { useState, useEffect, useRef, useCallback } from 'react';
import {
  videoCallService,
  VideoCallState,
  VideoCallStatus,
  NetworkQuality,
  VideoCallRoom,
} from '../services/VideoCallService';

export interface VideoCallSummary {
  durationSeconds: number;
  tokensUsed: number;
}

export interface UseVideoCallReturn {
  /** Current call status */
  status: VideoCallStatus;
  /** Whether the call is currently connected */
  isConnected: boolean;
  /** Room metadata (companion info, cost, etc.) */
  room: VideoCallRoom | null;
  /** Human-readable error message */
  error: string | null;
  /** Call duration in seconds (updates every second while connected) */
  duration: number;
  /** Microphone muted */
  isMicMuted: boolean;
  /** Local camera enabled */
  isCameraEnabled: boolean;
  /** Audio routed to speaker */
  isSpeakerOn: boolean;
  /** Network quality indicator */
  networkQuality: NetworkQuality;
  /** Call summary after ending (duration + tokens) */
  summary: VideoCallSummary | null;

  /** Start a video call with the given companion */
  startCall: (companionId: string) => Promise<void>;
  /** End the current call */
  endCall: () => Promise<void>;
  /** Toggle microphone mute */
  toggleMic: () => Promise<void>;
  /** Toggle local camera */
  toggleCamera: () => Promise<void>;
  /** Toggle speaker/earpiece */
  toggleSpeaker: () => void;
  /** Reset to idle state (navigate away from ended screen) */
  reset: () => void;
}

/**
 * React hook wrapping VideoCallService.
 *
 * Provides reactive state for the video call lifecycle, a call duration timer,
 * and convenience methods for controlling the call.
 */
export function useVideoCall(): UseVideoCallReturn {
  const [state, setState] = useState<VideoCallState>(videoCallService.getState());
  const [duration, setDuration] = useState(0);
  const [summary, setSummary] = useState<VideoCallSummary | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Subscribe to service state changes
  useEffect(() => {
    const unsubscribe = videoCallService.subscribe((newState) => {
      setState(newState);
    });
    return unsubscribe;
  }, []);

  // Duration timer: tick every second while connected
  useEffect(() => {
    if (state.status === 'connected' && state.startedAt) {
      // Immediately compute current duration from startedAt
      setDuration(Math.floor((Date.now() - state.startedAt) / 1000));

      durationTimerRef.current = setInterval(() => {
        if (state.startedAt) {
          setDuration(Math.floor((Date.now() - state.startedAt) / 1000));
        }
      }, 1000);
    } else if (state.status !== 'connected' && state.status !== 'reconnecting') {
      // Stop the timer when no longer in a live call
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    }

    return () => {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    };
  }, [state.status, state.startedAt]);

  const startCall = useCallback(async (companionId: string) => {
    setSummary(null);
    setDuration(0);
    await videoCallService.startCall(companionId);
  }, []);

  const endCall = useCallback(async () => {
    const result = await videoCallService.endCall();
    if (result) {
      setSummary(result);
    }
  }, []);

  const toggleMic = useCallback(async () => {
    await videoCallService.toggleMic();
  }, []);

  const toggleCamera = useCallback(async () => {
    await videoCallService.toggleCamera();
  }, []);

  const toggleSpeaker = useCallback(() => {
    videoCallService.toggleSpeaker();
  }, []);

  const reset = useCallback(() => {
    videoCallService.reset();
    setSummary(null);
    setDuration(0);
  }, []);

  return {
    status: state.status,
    isConnected: state.status === 'connected',
    room: state.room,
    error: state.error,
    duration,
    isMicMuted: state.isMicMuted,
    isCameraEnabled: state.isCameraEnabled,
    isSpeakerOn: state.isSpeakerOn,
    networkQuality: state.networkQuality,
    summary,
    startCall,
    endCall,
    toggleMic,
    toggleCamera,
    toggleSpeaker,
    reset,
  };
}
