import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideoCall } from '../use-video-call';

// Mock livekit-client
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn();
const mockSetMicrophoneEnabled = vi.fn().mockResolvedValue(undefined);
const mockSetCameraEnabled = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();

vi.mock('livekit-client', () => {
  return {
    Room: vi.fn().mockImplementation(() => ({
      connect: mockConnect,
      disconnect: mockDisconnect,
      localParticipant: {
        setMicrophoneEnabled: mockSetMicrophoneEnabled,
        setCameraEnabled: mockSetCameraEnabled,
      },
      on: mockOn,
    })),
    RoomEvent: {
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      Disconnected: 'disconnected',
      Reconnecting: 'reconnecting',
      Reconnected: 'reconnected',
      ConnectionStateChanged: 'connectionStateChanged',
    },
    Track: {
      Kind: {
        Video: 'video',
        Audio: 'audio',
      },
    },
    ConnectionState: {
      Connected: 'connected',
    },
    DisconnectReason: {},
  };
});

// Mock the API client
vi.mock('@/lib/api/client', () => ({
  post: vi.fn(),
  get: vi.fn(),
  apiClient: vi.fn(),
}));

// Mock auth store
vi.mock('@/stores/auth-store', () => ({
  getAccessToken: vi.fn().mockReturnValue('mock-token'),
}));

import { post } from '@/lib/api/client';

const mockPost = post as Mock;

describe('useVideoCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({
      success: true,
      data: {
        callId: 'call-123',
        roomUrl: 'wss://livekit.example.com',
        token: 'lk-token-abc',
        livekitUrl: 'wss://livekit.example.com',
      },
    });

    // Mock getUserMedia
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({}),
      },
    });
  });

  it('should start in idle state', () => {
    const { result } = renderHook(() =>
      useVideoCall({
        companionId: 'companion-1',
        sessionId: 'session-1',
      }),
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.isConnected).toBe(false);
    expect(result.current.duration).toBe(0);
    expect(result.current.remoteVideoTrack).toBeNull();
    expect(result.current.remoteAudioTrack).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should transition to connecting when starting a call', async () => {
    const { result } = renderHook(() =>
      useVideoCall({
        companionId: 'companion-1',
        sessionId: 'session-1',
      }),
    );

    await act(async () => {
      await result.current.startVideoCall();
    });

    // Should have called the API
    expect(mockPost).toHaveBeenCalledWith('/video-calls', {
      companionId: 'companion-1',
      sessionId: 'session-1',
    });

    // Should have connected to LiveKit
    expect(mockConnect).toHaveBeenCalledWith('wss://livekit.example.com', 'lk-token-abc');

    // Should have enabled the microphone
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
  });

  it('should not start if already connecting', async () => {
    mockPost.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ success: true, data: { callId: 'c1', roomUrl: '', token: '', livekitUrl: '' } }), 1000),
        ),
    );

    const { result } = renderHook(() =>
      useVideoCall({
        companionId: 'companion-1',
        sessionId: 'session-1',
      }),
    );

    // Start first call (don't await)
    act(() => {
      void result.current.startVideoCall();
    });

    // Try to start again immediately
    await act(async () => {
      await result.current.startVideoCall();
    });

    // Should only have called the API once
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('should handle errors when starting a call', async () => {
    mockPost.mockRejectedValue(new Error('Server error'));
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useVideoCall({
        companionId: 'companion-1',
        sessionId: 'session-1',
        onError,
      }),
    );

    await act(async () => {
      await result.current.startVideoCall();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBe('Server error');
    expect(onError).toHaveBeenCalledWith('Server error');
  });

  it('should not start without a companionId', async () => {
    const { result } = renderHook(() =>
      useVideoCall({
        companionId: null,
        sessionId: 'session-1',
      }),
    );

    await act(async () => {
      await result.current.startVideoCall();
    });

    expect(result.current.error).toBe('No companion selected');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('should end a video call and notify server', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: {
        callId: 'call-123',
        roomUrl: 'wss://livekit.example.com',
        token: 'lk-token-abc',
        livekitUrl: 'wss://livekit.example.com',
      },
    });
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { duration: 120, tokensUsed: 50 },
    });

    const onCallEnded = vi.fn();

    const { result } = renderHook(() =>
      useVideoCall({
        companionId: 'companion-1',
        sessionId: 'session-1',
        onCallEnded,
      }),
    );

    // Start the call
    await act(async () => {
      await result.current.startVideoCall();
    });

    // End the call
    await act(async () => {
      await result.current.endVideoCall();
    });

    expect(result.current.status).toBe('ended');
    expect(mockDisconnect).toHaveBeenCalled();
    expect(onCallEnded).toHaveBeenCalledWith(120, 50);
    expect(result.current.callSummary).toEqual({ duration: 120, tokensUsed: 50 });
  });

  it('should toggle mic mute state', async () => {
    const { result } = renderHook(() =>
      useVideoCall({
        companionId: 'companion-1',
        sessionId: 'session-1',
      }),
    );

    // Start the call first
    await act(async () => {
      await result.current.startVideoCall();
    });

    expect(result.current.isMicMuted).toBe(false);

    act(() => {
      result.current.toggleMic();
    });

    expect(result.current.isMicMuted).toBe(true);
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false);
  });

  it('should toggle camera state', async () => {
    const { result } = renderHook(() =>
      useVideoCall({
        companionId: 'companion-1',
        sessionId: 'session-1',
      }),
    );

    // Start the call first
    await act(async () => {
      await result.current.startVideoCall();
    });

    expect(result.current.isCameraEnabled).toBe(false);

    await act(async () => {
      await result.current.toggleCamera();
    });

    expect(result.current.isCameraEnabled).toBe(true);
    expect(mockSetCameraEnabled).toHaveBeenCalledWith(true);
  });
});
