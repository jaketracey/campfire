'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { isNativeApp, playNativeAudio, stopNativeAudio } from '@/lib/native-bridge';

interface UseAudioPlayerOptions {
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
  onError?: (error: string) => void;
}

interface UseAudioPlayerReturn {
  isPlaying: boolean;
  isPending: boolean;
  currentTime: number;
  duration: number;
  queueAudio: (base64Data: string, format?: string) => void;
  finishQueue: () => void;
  stop: () => void;
  getAnalyserNode: () => AnalyserNode | null;
}

/**
 * Hook for playing TTS audio chunks streamed from the server
 * Supports MP3 audio format with smooth buffering and playback
 */
export function useAudioPlayer(options: UseAudioPlayerOptions = {}): UseAudioPlayerReturn {
  const { onPlaybackStart, onPlaybackEnd, onError } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const nativeQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const isFinishedRef = useRef(false);
  const isNativePlaybackRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef(0);
  const playedDurationRef = useRef(0);

  /**
   * Initialize audio context and analyser
   */
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.connect(audioContextRef.current.destination);
    }
    return audioContextRef.current;
  }, []);

  /**
   * Decode base64 audio data to ArrayBuffer
   */
  const base64ToArrayBuffer = useCallback((base64: string): ArrayBuffer => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }, []);

  /**
   * Play the next audio chunk from the queue
   */
  const playNextChunk = useCallback(async () => {
    if (audioQueueRef.current.length === 0) {
      if (isFinishedRef.current) {
        // All audio played
        isPlayingRef.current = false;
        setIsPlaying(false);
        setIsPending(false);
        onPlaybackEnd?.();
      } else {
        // Waiting for more chunks
        setIsPending(true);
      }
      return;
    }

    const audioContext = initAudioContext();

    // Resume if suspended
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const arrayBuffer = audioQueueRef.current.shift()!;

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      currentSourceRef.current = source;

      // Connect through analyser for visualization
      if (analyserRef.current) {
        source.connect(analyserRef.current);
      } else {
        source.connect(audioContext.destination);
      }

      source.onended = () => {
        playedDurationRef.current += audioBuffer.duration;
        setCurrentTime(playedDurationRef.current);
        currentSourceRef.current = null;
        playNextChunk();
      };

      if (!isPlayingRef.current) {
        isPlayingRef.current = true;
        setIsPlaying(true);
        setIsPending(false);
        startTimeRef.current = audioContext.currentTime;
        onPlaybackStart?.();
      }

      source.start();
      setDuration((prev) => prev + audioBuffer.duration);
    } catch (err) {
      console.error('[AudioPlayer] Failed to decode audio:', err);
      onError?.(err instanceof Error ? err.message : 'Failed to decode audio');
      // Continue with next chunk
      playNextChunk();
    }
  }, [initAudioContext, onPlaybackStart, onPlaybackEnd, onError]);

  /**
   * Play native audio queue
   */
  const playNativeQueue = useCallback(async () => {
    if (nativeQueueRef.current.length === 0) {
      if (isFinishedRef.current) {
        isPlayingRef.current = false;
        isNativePlaybackRef.current = false;
        setIsPlaying(false);
        setIsPending(false);
        onPlaybackEnd?.();
      } else {
        setIsPending(true);
      }
      return;
    }

    const base64Data = nativeQueueRef.current.shift()!;

    try {
      if (!isPlayingRef.current) {
        isPlayingRef.current = true;
        setIsPlaying(true);
        setIsPending(false);
        onPlaybackStart?.();
      }

      await playNativeAudio(base64Data);
      playNativeQueue();
    } catch (err) {
      console.error('[AudioPlayer] Native playback error:', err);
      onError?.(err instanceof Error ? err.message : 'Failed to play audio');
      playNativeQueue();
    }
  }, [onPlaybackStart, onPlaybackEnd, onError]);

  /**
   * Queue audio chunk for playback
   */
  const queueAudio = useCallback(
    (base64Data: string, format = 'mp3') => {
      // Use native playback when running in mobile app
      if (isNativeApp()) {
        nativeQueueRef.current.push(base64Data);
        isNativePlaybackRef.current = true;

        // Start playback if not already playing
        if (!isPlayingRef.current && !isPending) {
          isFinishedRef.current = false;
          playNativeQueue();
        }
        return;
      }

      const arrayBuffer = base64ToArrayBuffer(base64Data);
      audioQueueRef.current.push(arrayBuffer);

      // Start playback if not already playing
      if (!isPlayingRef.current && !isPending) {
        isFinishedRef.current = false;
        playNextChunk();
      }
    },
    [base64ToArrayBuffer, isPending, playNextChunk, playNativeQueue]
  );

  /**
   * Signal that all audio chunks have been received
   */
  const finishQueue = useCallback(() => {
    isFinishedRef.current = true;

    // If not currently playing and queue is empty, end now
    if (!isPlayingRef.current && audioQueueRef.current.length === 0) {
      setIsPending(false);
      onPlaybackEnd?.();
    }
  }, [onPlaybackEnd]);

  /**
   * Stop playback immediately
   */
  const stop = useCallback(() => {
    // Stop native playback if active
    if (isNativePlaybackRef.current) {
      stopNativeAudio();
      nativeQueueRef.current = [];
      isNativePlaybackRef.current = false;
    }

    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {
        // Ignore if already stopped
      }
      currentSourceRef.current = null;
    }

    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isFinishedRef.current = true;
    playedDurationRef.current = 0;

    setIsPlaying(false);
    setIsPending(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  /**
   * Get analyser node for visualization
   */
  const getAnalyserNode = useCallback((): AnalyserNode | null => {
    initAudioContext();
    return analyserRef.current;
  }, [initAudioContext]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
        analyserRef.current = null;
      }
    };
  }, [stop]);

  return {
    isPlaying,
    isPending,
    currentTime,
    duration,
    queueAudio,
    finishQueue,
    stop,
    getAnalyserNode,
  };
}
