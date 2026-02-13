/**
 * Voice Recording Hook Tests
 * Focus on resource cleanup and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoiceRecording } from '../use-voice-recording';
import type { CampfireWebSocket } from '@/lib/ws';

// Mock MediaDevices
class MockMediaStream {
  private tracks: MockMediaStreamTrack[] = [];

  constructor() {
    this.tracks = [new MockMediaStreamTrack()];
  }

  getTracks() {
    return this.tracks;
  }

  getAudioTracks() {
    return this.tracks;
  }
}

class MockMediaStreamTrack {
  kind = 'audio';
  enabled = true;
  readyState: 'live' | 'ended' = 'live';

  stop() {
    this.readyState = 'ended';
  }
}

// Mock AudioContext
class MockAudioContext {
  state: 'running' | 'closed' = 'running';
  sampleRate = 48000;
  private closePromise: Promise<void> | null = null;

  createMediaStreamSource() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  async close() {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closePromise = new Promise((resolve) => {
      setTimeout(() => {
        this.state = 'closed';
        resolve();
      }, 10);
    });
    return this.closePromise;
  }

  get audioWorklet() {
    return {
      addModule: vi.fn().mockResolvedValue(undefined),
    };
  }

  destination = {};
}

// Mock AudioWorkletNode
class MockAudioWorkletNode {
  port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
  };

  connect = vi.fn();
  disconnect = vi.fn();
}

describe('useVoiceRecording - Resource Cleanup', () => {
  let mockWs: Partial<CampfireWebSocket>;
  let mockGetUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();

    mockWs = {
      isConnected: true,
      startVoice: vi.fn(),
      sendVoiceChunk: vi.fn(),
      endVoice: vi.fn(),
    };

    // Setup global mocks
    mockGetUserMedia = vi.fn().mockResolvedValue(new MockMediaStream());
    global.navigator = {
      ...global.navigator,
      mediaDevices: {
        getUserMedia: mockGetUserMedia,
      } as unknown as MediaDevices,
    };

    global.AudioContext = MockAudioContext as unknown as typeof AudioContext;
    global.AudioWorkletNode = MockAudioWorkletNode as unknown as typeof AudioWorkletNode;
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should clean up all resources on unmount during recording', async () => {
    const wsRef = { current: mockWs as CampfireWebSocket };
    const { result, unmount } = renderHook(() => useVoiceRecording(wsRef));

    // Start recording
    await act(async () => {
      await result.current.startRecording();
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(result.current.isRecording).toBe(true);

    // Capture references before unmount
    const audioContext = result.current.audioContextRef.current;
    const mediaStream = result.current.mediaStreamRef.current;

    // Unmount while recording
    await act(async () => {
      unmount();
      await vi.advanceTimersByTimeAsync(50);
    });

    // Verify cleanup
    expect(audioContext?.state).toBe('closed');
    expect(mediaStream?.getTracks()[0].readyState).toBe('ended');
  });

  it('should not set interval when recording fails to start', async () => {
    const wsRef = { current: mockWs as CampfireWebSocket };

    mockGetUserMedia.mockRejectedValue(new Error('Permission denied'));

    const { result } = renderHook(() => useVoiceRecording(wsRef));

    await act(async () => {
      await result.current.startRecording();
      await vi.advanceTimersByTimeAsync(50);
    });

    // Verify no lingering intervals
    const intervalCount = vi.getTimerCount();
    expect(intervalCount).toBe(0);
  });

  it('should handle AudioContext.close() rejection gracefully', async () => {
    const wsRef = { current: mockWs as CampfireWebSocket };

    // Mock AudioContext that rejects on close
    class FailingAudioContext extends MockAudioContext {
      async close() {
        throw new Error('AudioContext close failed');
      }
    }

    global.AudioContext = FailingAudioContext as unknown as typeof AudioContext;

    const { result } = renderHook(() => useVoiceRecording(wsRef));

    await act(async () => {
      await result.current.startRecording();
      await vi.advanceTimersByTimeAsync(50);
    });

    // Should not throw when stopping
    await act(async () => {
      const stopRecording = result.current.stopRecording();
      await vi.advanceTimersByTimeAsync(50);
      await stopRecording;
    });

    expect(result.current.isRecording).toBe(false);
  });

  it('should stop all MediaStream tracks even if one fails', async () => {
    const wsRef = { current: mockWs as CampfireWebSocket };

    const track1 = new MockMediaStreamTrack();
    const track2 = new MockMediaStreamTrack();
    const track3 = new MockMediaStreamTrack();

    // Make second track throw on stop
    track2.stop = vi.fn().mockImplementation(() => {
      throw new Error('Stop failed');
    });

    const mockStream = {
      getTracks: () => [track1, track2, track3],
      getAudioTracks: () => [track1, track2, track3],
    };

    mockGetUserMedia.mockResolvedValue(mockStream);

    const { result } = renderHook(() => useVoiceRecording(wsRef));

    await act(async () => {
      await result.current.startRecording();
      await vi.advanceTimersByTimeAsync(50);
    });

    await act(async () => {
      const stopRecording = result.current.stopRecording();
      await vi.advanceTimersByTimeAsync(50);
      await stopRecording;
    });

    // All tracks should have been attempted to stop
    expect(track1.readyState).toBe('ended');
    expect(track3.readyState).toBe('ended');
  });

  it('should not leak memory on multiple start/stop cycles', async () => {
    const wsRef = { current: mockWs as CampfireWebSocket };
    const { result } = renderHook(() => useVoiceRecording(wsRef));

    // Run 5 start/stop cycles
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await result.current.startRecording();
        await vi.advanceTimersByTimeAsync(100);
      });

      await act(async () => {
        const stopRecording = result.current.stopRecording();
        await vi.advanceTimersByTimeAsync(50);
        await stopRecording;
      });
    }

    // Should have no lingering timers
    expect(vi.getTimerCount()).toBe(0);

    // Should have cleaned up all resources
    expect(result.current.audioContextRef.current).toBeNull();
    expect(result.current.mediaStreamRef.current).toBeNull();
  });

  it('should clean up worklet node before audio context', async () => {
    const wsRef = { current: mockWs as CampfireWebSocket };
    const { result } = renderHook(() => useVoiceRecording(wsRef));

    const disconnectOrder: string[] = [];

    // Track disconnect order
    const originalAudioWorkletNode = global.AudioWorkletNode;
    global.AudioWorkletNode = class extends MockAudioWorkletNode {
      disconnect = vi.fn(() => {
        disconnectOrder.push('worklet');
      });
    } as unknown as typeof AudioWorkletNode;

    const originalAudioContext = global.AudioContext;
    global.AudioContext = class extends MockAudioContext {
      async close() {
        disconnectOrder.push('context');
        return super.close();
      }
    } as unknown as typeof AudioContext;

    await act(async () => {
      await result.current.startRecording();
      await vi.advanceTimersByTimeAsync(50);
    });

    await act(async () => {
      const stopRecording = result.current.stopRecording();
      await vi.advanceTimersByTimeAsync(50);
      await stopRecording;
    });

    // Worklet should be disconnected before context is closed
    expect(disconnectOrder).toEqual(['worklet', 'context']);

    global.AudioWorkletNode = originalAudioWorkletNode;
    global.AudioContext = originalAudioContext;
  });
});

describe('useVoiceRecording - Error Handling', () => {
  let mockWs: Partial<CampfireWebSocket>;

  beforeEach(() => {
    vi.useFakeTimers();

    mockWs = {
      isConnected: true,
      startVoice: vi.fn(),
      sendVoiceChunk: vi.fn(),
      endVoice: vi.fn(),
    };

    global.navigator = {
      ...global.navigator,
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream()),
      } as unknown as MediaDevices,
    };

    global.AudioContext = MockAudioContext as unknown as typeof AudioContext;
    global.AudioWorkletNode = MockAudioWorkletNode as unknown as typeof AudioWorkletNode;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should surface permission denied errors to user', async () => {
    const wsRef = { current: mockWs as CampfireWebSocket };
    const getUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));
    global.navigator.mediaDevices.getUserMedia = getUserMedia;

    const { result } = renderHook(() => useVoiceRecording(wsRef));

    await act(async () => {
      await result.current.startRecording();
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(result.current.error).toContain('Permission denied');
    expect(result.current.isRecording).toBe(false);
  });

  it('should handle worklet loading failure', async () => {
    const wsRef = { current: mockWs as CampfireWebSocket };

    class FailingWorkletContext extends MockAudioContext {
      get audioWorklet() {
        return {
          addModule: vi.fn().mockRejectedValue(new Error('Worklet load failed')),
        };
      }
    }

    global.AudioContext = FailingWorkletContext as unknown as typeof AudioContext;

    const { result } = renderHook(() => useVoiceRecording(wsRef));

    await act(async () => {
      await result.current.startRecording();
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.isRecording).toBe(false);
  });
});
