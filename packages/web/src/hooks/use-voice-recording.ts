'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { CampfireWebSocket } from '@/lib/ws';
import { isNativeApp, getNativeBridge, onNativeRecordingComplete } from '@/lib/native-bridge';

interface UseVoiceRecordingOptions {
  sampleRate?: number;
  chunkInterval?: number;
}

interface UseVoiceRecordingReturn {
  isRecording: boolean;
  isPermissionGranted: boolean;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  requestPermission: () => Promise<boolean>;
}

/**
 * Hook for push-to-talk voice recording
 * Records audio at 16kHz PCM and streams base64 chunks via WebSocket
 */
export function useVoiceRecording(
  wsRef: React.RefObject<CampfireWebSocket | null>,
  options: UseVoiceRecordingOptions = {}
): UseVoiceRecordingReturn {
  const { sampleRate = 16000, chunkInterval = 100 } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [isPermissionGranted, setIsPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const chunkIntervalRef = useRef<number | null>(null);
  const isNativeRecordingRef = useRef(false);

  /**
   * Convert Float32Array audio samples to 16-bit PCM base64
   */
  const float32ToBase64PCM = useCallback((float32Array: Float32Array): string => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }, []);

  /**
   * Downsample audio from source sample rate to target sample rate
   */
  const downsample = useCallback(
    (buffer: Float32Array, sourceSampleRate: number, targetSampleRate: number): Float32Array => {
      if (sourceSampleRate === targetSampleRate) {
        return buffer;
      }
      const ratio = sourceSampleRate / targetSampleRate;
      const newLength = Math.round(buffer.length / ratio);
      const result = new Float32Array(newLength);
      for (let i = 0; i < newLength; i++) {
        const index = Math.round(i * ratio);
        result[i] = buffer[index] ?? 0;
      }
      return result;
    },
    []
  );

  /**
   * Send accumulated audio chunks via WebSocket
   */
  const sendAudioChunks = useCallback(() => {
    if (audioBufferRef.current.length === 0) return;
    if (!wsRef.current?.isConnected) return;

    // Concatenate all buffered samples
    const totalLength = audioBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of audioBufferRef.current) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    audioBufferRef.current = [];

    // Downsample to target sample rate
    const sourceSampleRate = audioContextRef.current?.sampleRate ?? 48000;
    const downsampled = downsample(combined, sourceSampleRate, sampleRate);

    // Convert to base64 PCM and send
    const base64Data = float32ToBase64PCM(downsampled);
    wsRef.current.sendVoiceChunk(base64Data);
  }, [wsRef, sampleRate, downsample, float32ToBase64PCM]);

  /**
   * Request microphone permission
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setIsPermissionGranted(true);
      setError(null);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Microphone permission denied';
      setError(message);
      setIsPermissionGranted(false);
      return false;
    }
  }, []);

  /**
   * Start recording audio
   */
  const startRecording = useCallback(async () => {
    if (isRecording) return;
    setError(null);

    // Use native recording when running in mobile app
    if (isNativeApp()) {
      const bridge = getNativeBridge();
      if (bridge) {
        try {
          await bridge.startRecording();
          isNativeRecordingRef.current = true;
          setIsRecording(true);
          setIsPermissionGranted(true);
          wsRef.current?.startVoice();
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to start native recording';
          setError(message);
          console.error('[VoiceRecording] Native recording error:', err);
          return;
        }
      }
    }

    try {
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      setIsPermissionGranted(true);

      // Create audio context
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Load and register the audio worklet processor
      const workletCode = `
        class AudioChunkProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
          }
          process(inputs) {
            const input = inputs[0];
            if (input && input[0]) {
              this.port.postMessage(new Float32Array(input[0]));
            }
            return true;
          }
        }
        registerProcessor('audio-chunk-processor', AudioChunkProcessor);
      `;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      // Create source and worklet node
      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, 'audio-chunk-processor');
      workletNodeRef.current = workletNode;

      // Collect audio samples
      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        audioBufferRef.current.push(event.data);
      };

      // Connect audio pipeline
      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      // Start sending chunks at regular intervals
      chunkIntervalRef.current = window.setInterval(sendAudioChunks, chunkInterval);

      // Signal voice start
      wsRef.current?.startVoice();

      setIsRecording(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start recording';
      setError(message);
      console.error('[VoiceRecording] Error starting:', err);
    }
  }, [isRecording, wsRef, chunkInterval, sendAudioChunks]);

  /**
   * Stop recording audio
   */
  const stopRecording = useCallback(async () => {
    if (!isRecording) return;

    // Handle native recording stop
    if (isNativeRecordingRef.current) {
      const bridge = getNativeBridge();
      if (bridge) {
        try {
          const result = await bridge.stopRecording();
          if (result.audioData) {
            // Send the recorded audio as a single chunk
            wsRef.current?.sendVoiceChunk(result.audioData);
          }
        } catch (err) {
          console.error('[VoiceRecording] Native stop error:', err);
        }
      }
      isNativeRecordingRef.current = false;
      wsRef.current?.endVoice();
      setIsRecording(false);
      return;
    }

    // Stop chunk interval
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }

    // Send any remaining audio
    sendAudioChunks();

    // Signal voice end
    wsRef.current?.endVoice();

    // Cleanup audio worklet
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // Cleanup audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Clear buffer
    audioBufferRef.current = [];

    setIsRecording(false);
  }, [isRecording, wsRef, sendAudioChunks]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chunkIntervalRef.current) {
        clearInterval(chunkIntervalRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    isRecording,
    isPermissionGranted,
    error,
    startRecording,
    stopRecording,
    requestPermission,
  };
}
