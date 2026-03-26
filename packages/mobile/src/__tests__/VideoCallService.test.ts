/**
 * Tests for VideoCallService
 *
 * Mocks fetch for API calls and @livekit/react-native for room connections.
 */

// Mock SecureStore
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

// Mock AppState
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Platform: { OS: 'ios' },
}));

// Mock LiveKit
const mockRoom = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  on: jest.fn(),
  localParticipant: {
    setMicrophoneEnabled: jest.fn(),
    setCameraEnabled: jest.fn(),
  },
};

jest.mock('@livekit/react-native', () => ({
  Room: jest.fn(() => mockRoom),
  RoomEvent: {
    ConnectionQualityChanged: 'connectionQualityChanged',
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
  },
}));

import * as SecureStore from 'expo-secure-store';

// We need to require the service after mocks are in place
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { videoCallService } = require('../services/VideoCallService');

const MOCK_AUTH_TOKEN = 'test-token-123';
const MOCK_ROOM_RESPONSE = {
  id: 'room-abc',
  roomUrl: 'wss://livekit.example.com',
  token: 'lk-token-xyz',
  companionId: 'companion-1',
  companionName: 'Aria',
  costPerMinute: 5,
};

describe('VideoCallService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    videoCallService.reset();
    videoCallService.setGatewayUrl('https://api.example.com');

    // Default auth mock
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(
      JSON.stringify({ accessToken: MOCK_AUTH_TOKEN })
    );

    // Default fetch mock
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_ROOM_RESPONSE),
    });

    // Reset LiveKit mock
    mockRoom.connect.mockResolvedValue(undefined);
    mockRoom.disconnect.mockResolvedValue(undefined);
    mockRoom.localParticipant.setMicrophoneEnabled.mockResolvedValue(undefined);
    mockRoom.localParticipant.setCameraEnabled.mockResolvedValue(undefined);
  });

  describe('startCall', () => {
    it('should transition through requesting -> connecting -> connected', async () => {
      const states: string[] = [];
      videoCallService.subscribe((state: { status: string }) => {
        states.push(state.status);
      });

      await videoCallService.startCall('companion-1');

      expect(states).toContain('requesting');
      expect(states).toContain('connecting');
      expect(states).toContain('connected');
    });

    it('should POST to the gateway to create a room', async () => {
      await videoCallService.startCall('companion-1');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/video-calls',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_AUTH_TOKEN}`,
          }),
          body: JSON.stringify({ companionId: 'companion-1' }),
        })
      );
    });

    it('should connect to LiveKit with the returned token', async () => {
      await videoCallService.startCall('companion-1');

      expect(mockRoom.connect).toHaveBeenCalledWith(
        MOCK_ROOM_RESPONSE.roomUrl,
        MOCK_ROOM_RESPONSE.token
      );
    });

    it('should enable microphone after connecting', async () => {
      await videoCallService.startCall('companion-1');

      expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    });

    it('should set error state when not authenticated', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

      await videoCallService.startCall('companion-1');

      const state = videoCallService.getState();
      expect(state.status).toBe('error');
      expect(state.error).toContain('authenticated');
    });

    it('should set error state when API returns error', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 402,
        json: () => Promise.resolve({ message: 'Insufficient tokens' }),
      });

      await videoCallService.startCall('companion-1');

      const state = videoCallService.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('Insufficient tokens');
    });

    it('should set error state when LiveKit connection fails', async () => {
      mockRoom.connect.mockRejectedValue(new Error('WebRTC failure'));

      await videoCallService.startCall('companion-1');

      const state = videoCallService.getState();
      expect(state.status).toBe('error');
      expect(state.error).toContain('Failed to connect');
    });

    it('should not start a call if already in progress', async () => {
      // Start first call
      const promise = videoCallService.startCall('companion-1');

      // Try starting another -- should be ignored
      await videoCallService.startCall('companion-2');

      await promise;

      // Only one fetch call for room creation
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('endCall', () => {
    beforeEach(async () => {
      await videoCallService.startCall('companion-1');
    });

    it('should POST to gateway to end the call', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ durationSeconds: 120, tokensUsed: 10 }),
      });

      await videoCallService.endCall();

      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.example.com/api/v1/video-calls/${MOCK_ROOM_RESPONSE.id}/end`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should disconnect from LiveKit', async () => {
      await videoCallService.endCall();

      expect(mockRoom.disconnect).toHaveBeenCalled();
    });

    it('should return call summary', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ durationSeconds: 120, tokensUsed: 10 }),
      });

      const summary = await videoCallService.endCall();

      expect(summary).toEqual({ durationSeconds: 120, tokensUsed: 10 });
    });

    it('should transition to ended status', async () => {
      await videoCallService.endCall();

      expect(videoCallService.getState().status).toBe('ended');
    });

    it('should still end cleanly if API call fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await videoCallService.endCall();

      expect(videoCallService.getState().status).toBe('ended');
      expect(mockRoom.disconnect).toHaveBeenCalled();
    });
  });

  describe('toggleMic', () => {
    beforeEach(async () => {
      await videoCallService.startCall('companion-1');
    });

    it('should toggle microphone mute state', async () => {
      expect(videoCallService.getState().isMicMuted).toBe(false);

      await videoCallService.toggleMic();
      expect(videoCallService.getState().isMicMuted).toBe(true);

      await videoCallService.toggleMic();
      expect(videoCallService.getState().isMicMuted).toBe(false);
    });

    it('should call LiveKit setMicrophoneEnabled', async () => {
      await videoCallService.toggleMic();

      // First call was enabling mic during connect, second is toggling off
      expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    });
  });

  describe('toggleCamera', () => {
    beforeEach(async () => {
      await videoCallService.startCall('companion-1');
    });

    it('should toggle camera state', async () => {
      expect(videoCallService.getState().isCameraEnabled).toBe(false);

      await videoCallService.toggleCamera();
      expect(videoCallService.getState().isCameraEnabled).toBe(true);

      await videoCallService.toggleCamera();
      expect(videoCallService.getState().isCameraEnabled).toBe(false);
    });
  });

  describe('toggleSpeaker', () => {
    it('should toggle speaker state', () => {
      expect(videoCallService.getState().isSpeakerOn).toBe(true);

      videoCallService.toggleSpeaker();
      expect(videoCallService.getState().isSpeakerOn).toBe(false);

      videoCallService.toggleSpeaker();
      expect(videoCallService.getState().isSpeakerOn).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('should notify listeners of state changes', async () => {
      const listener = jest.fn();
      videoCallService.subscribe(listener);

      await videoCallService.startCall('companion-1');

      // Should have been called multiple times as state transitions
      expect(listener.mock.calls.length).toBeGreaterThan(1);
    });

    it('should return unsubscribe function', () => {
      const listener = jest.fn();
      const unsubscribe = videoCallService.subscribe(listener);

      // Called immediately with current state
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      videoCallService.toggleSpeaker();

      // Should not be called again after unsubscribing
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset', () => {
    it('should return to idle state', async () => {
      await videoCallService.startCall('companion-1');
      await videoCallService.endCall();

      videoCallService.reset();

      const state = videoCallService.getState();
      expect(state.status).toBe('idle');
      expect(state.room).toBeNull();
      expect(state.error).toBeNull();
    });
  });
});
