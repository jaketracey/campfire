'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  ConnectionState,
  DisconnectReason,
} from 'livekit-client';
import { post } from '@/lib/api/client';

export type VideoCallStatus = 'idle' | 'connecting' | 'active' | 'reconnecting' | 'ending' | 'ended';

interface StartVideoCallResponse {
  success: boolean;
  data: {
    callId: string;
    roomUrl: string;
    token: string;
    livekitUrl: string;
  };
}

interface EndVideoCallResponse {
  success: boolean;
  data: {
    duration: number;
    tokensUsed: number;
  };
}

interface UseVideoCallOptions {
  companionId: string | null;
  sessionId: string;
  onError?: (error: string) => void;
  onCallEnded?: (duration: number, tokensUsed: number) => void;
  onBillingUpdate?: (tokensUsed: number, balance: number) => void;
}

interface UseVideoCallReturn {
  status: VideoCallStatus;
  isConnected: boolean;
  duration: number;
  remoteVideoTrack: RemoteTrack | null;
  remoteAudioTrack: RemoteTrack | null;
  isMicMuted: boolean;
  isCameraEnabled: boolean;
  error: string | null;
  callId: string | null;
  callSummary: { duration: number; tokensUsed: number } | null;
  startVideoCall: () => Promise<void>;
  endVideoCall: () => Promise<void>;
  toggleMic: () => void;
  toggleCamera: () => Promise<void>;
}

export function useVideoCall({
  companionId,
  sessionId,
  onError,
  onCallEnded,
}: UseVideoCallOptions): UseVideoCallReturn {
  const [status, setStatus] = useState<VideoCallStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<RemoteTrack | null>(null);
  const [remoteAudioTrack, setRemoteAudioTrack] = useState<RemoteTrack | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [callSummary, setCallSummary] = useState<{ duration: number; tokensUsed: number } | null>(null);

  const roomRef = useRef<Room | null>(null);
  const callIdRef = useRef<string | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const intentionalDisconnectRef = useRef(false);

  // Duration timer
  useEffect(() => {
    if (status === 'active' && !durationIntervalRef.current) {
      startTimeRef.current = Date.now();
      durationIntervalRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);
    }

    return () => {
      if (status !== 'active' && durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    };
  }, [status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    };
  }, []);

  const handleTrackSubscribed = useCallback(
    (track: RemoteTrack, publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
      void publication; // acknowledge usage
      if (track.kind === Track.Kind.Video) {
        setRemoteVideoTrack(track);
      } else if (track.kind === Track.Kind.Audio) {
        setRemoteAudioTrack(track);
        // Auto-attach audio
        const audioEl = track.attach();
        audioEl.id = 'video-call-remote-audio';
        document.body.appendChild(audioEl);
      }
    },
    [],
  );

  const handleTrackUnsubscribed = useCallback(
    (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video) {
        setRemoteVideoTrack(null);
      } else if (track.kind === Track.Kind.Audio) {
        setRemoteAudioTrack(null);
        track.detach().forEach((el) => el.remove());
      }
    },
    [],
  );

  const handleDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      if (!intentionalDisconnectRef.current) {
        const msg = reason ? `Disconnected: ${reason}` : 'Connection lost';
        setError(msg);
        onError?.(msg);
      }

      setRemoteVideoTrack(null);
      setRemoteAudioTrack(null);

      // Remove any attached audio elements
      const audioEl = document.getElementById('video-call-remote-audio');
      if (audioEl) audioEl.remove();

      if (status !== 'ending' && status !== 'ended') {
        setStatus('ended');
      }
    },
    [onError, status],
  );

  const handleReconnecting = useCallback(() => {
    setStatus('reconnecting');
  }, []);

  const handleReconnected = useCallback(() => {
    setStatus('active');
    setError(null);
  }, []);

  const startVideoCall = useCallback(async () => {
    if (status !== 'idle' && status !== 'ended') return;
    if (!companionId) {
      setError('No companion selected');
      return;
    }

    setError(null);
    setCallSummary(null);
    setDuration(0);
    setStatus('connecting');
    intentionalDisconnectRef.current = false;

    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create video call on the server
      const response = await post<StartVideoCallResponse>('/video-calls', {
        companionId,
        sessionId,
      });

      const { callId: newCallId, token, livekitUrl } = response.data;
      setCallId(newCallId);
      callIdRef.current = newCallId;

      // Create and connect to LiveKit room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Attach event handlers
      room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.on(RoomEvent.Disconnected, handleDisconnected);
      room.on(RoomEvent.Reconnecting, handleReconnecting);
      room.on(RoomEvent.Reconnected, handleReconnected);
      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (state === ConnectionState.Connected) {
          setStatus('active');
        }
      });

      roomRef.current = room;

      // Connect to room - publish audio by default, no video unless user enables
      await room.connect(livekitUrl, token);

      // Publish local microphone
      await room.localParticipant.setMicrophoneEnabled(true);

      setStatus('active');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start video call';
      setError(message);
      onError?.(message);
      setStatus('idle');

      // Cleanup
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    }
  }, [status, companionId, sessionId, handleTrackSubscribed, handleTrackUnsubscribed, handleDisconnected, handleReconnecting, handleReconnected, onError]);

  const endVideoCall = useCallback(async () => {
    intentionalDisconnectRef.current = true;
    setStatus('ending');

    // Stop duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Disconnect from room
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    // Remove attached audio elements
    const audioEl = document.getElementById('video-call-remote-audio');
    if (audioEl) audioEl.remove();

    setRemoteVideoTrack(null);
    setRemoteAudioTrack(null);

    // Notify server
    const currentCallId = callIdRef.current;
    if (currentCallId) {
      try {
        const response = await post<EndVideoCallResponse>(`/video-calls/${currentCallId}/end`);
        const summary = { duration: response.data.duration, tokensUsed: response.data.tokensUsed };
        setCallSummary(summary);
        onCallEnded?.(summary.duration, summary.tokensUsed);
      } catch {
        // End call even if server notification fails
      }
    }

    setStatus('ended');
  }, [onCallEnded]);

  const toggleMic = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;

    const newMuted = !isMicMuted;
    room.localParticipant.setMicrophoneEnabled(!newMuted);
    setIsMicMuted(newMuted);
  }, [isMicMuted]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    const newEnabled = !isCameraEnabled;
    await room.localParticipant.setCameraEnabled(newEnabled);
    setIsCameraEnabled(newEnabled);
  }, [isCameraEnabled]);

  return {
    status,
    isConnected: status === 'active',
    duration,
    remoteVideoTrack,
    remoteAudioTrack,
    isMicMuted,
    isCameraEnabled,
    error,
    callId,
    callSummary,
    startVideoCall,
    endVideoCall,
    toggleMic,
    toggleCamera,
  };
}
