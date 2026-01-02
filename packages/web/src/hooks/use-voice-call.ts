'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { MicVAD } from '@ricky0123/vad-web';
import type { CampfireWebSocket } from '@/lib/ws';

export type VoiceCallState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'processing'
  | 'companion_speaking';

interface UseVoiceCallOptions {
  onTranscription?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

interface UseVoiceCallReturn {
  callState: VoiceCallState;
  isCallActive: boolean;
  isMuted: boolean;
  currentTranscript: string;
  error: string | null;
  startCall: () => Promise<void>;
  endCall: () => void;
  toggleMute: () => void;
  getAnalyserNode: () => AnalyserNode | null;
  // Token billing state
  currentBalance: number | null;
  tokensUsed: number;
  insufficientTokens: boolean;
  clearInsufficientTokens: () => void;
}

/**
 * Hook for managing voice calls with VAD-based continuous listening
 * Uses @ricky0123/vad-web for voice activity detection
 */
export function useVoiceCall(
  wsRef: React.RefObject<CampfireWebSocket | null>,
  audioPlayerRef: React.RefObject<{
    stop: () => void;
    isPlaying: boolean;
    getAnalyserNode: () => AnalyserNode | null;
  } | null>,
  options: UseVoiceCallOptions = {}
): UseVoiceCallReturn {
  const { onTranscription, onError } = options;

  const [callState, setCallState] = useState<VoiceCallState>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Token billing state
  const [currentBalance, setCurrentBalance] = useState<number | null>(null);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [insufficientTokens, setInsufficientTokens] = useState(false);

  const vadRef = useRef<MicVAD | null>(null);
  const isCallActiveRef = useRef(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const isCallActive = callState !== 'idle';

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
   * Handle VAD detecting speech start
   */
  const handleSpeechStart = useCallback(() => {
    if (!isCallActiveRef.current || isMuted) return;

    console.log('[VoiceCall] Speech started');
    setCallState('speaking');

    // Interrupt companion if speaking
    if (audioPlayerRef.current?.isPlaying) {
      console.log('[VoiceCall] Interrupting companion speech');
      audioPlayerRef.current.stop();
      wsRef.current?.interruptVoiceCall();
    }
  }, [isMuted, audioPlayerRef, wsRef]);

  /**
   * Handle VAD detecting speech end - send audio for processing
   */
  const handleSpeechEnd = useCallback(
    (audio: Float32Array) => {
      if (!isCallActiveRef.current || isMuted) return;

      console.log('[VoiceCall] Speech ended, sending audio');
      setCallState('processing');
      setCurrentTranscript('');

      // Convert and send audio via WebSocket
      const base64Data = float32ToBase64PCM(audio);
      wsRef.current?.startVoice();
      wsRef.current?.sendVoiceChunk(base64Data);
      wsRef.current?.endVoice();
    },
    [isMuted, wsRef, float32ToBase64PCM]
  );

  /**
   * Start a voice call
   */
  const startCall = useCallback(async () => {
    if (isCallActiveRef.current) return;

    setError(null);
    setCallState('connecting');

    try {
      // Request microphone permission first
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Initialize VAD with self-hosted assets (avoids CDN loading issues)
      console.log('[VoiceCall] Initializing VAD...');
      const vad = await MicVAD.new({
        onSpeechStart: handleSpeechStart,
        onSpeechEnd: handleSpeechEnd,
        positiveSpeechThreshold: 0.8,
        negativeSpeechThreshold: 0.35,
        model: 'v5', // Use newer v5 model for better accuracy
        // Self-hosted ONNX runtime and VAD model files in /public/vad/
        onnxWASMBasePath: '/vad/',
        baseAssetPath: '/vad/',
      });

      vadRef.current = vad;
      isCallActiveRef.current = true;

      // Create audio context for visualization
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      // Signal call start to backend
      wsRef.current?.startVoiceCall();
      wsRef.current?.enableVoice();

      // Start VAD listening
      vad.start();
      setCallState('listening');
      console.log('[VoiceCall] Call started, listening...');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start voice call';
      console.error('[VoiceCall] Error:', err);
      setError(message);
      onError?.(message);
      setCallState('idle');
      isCallActiveRef.current = false;
    }
  }, [wsRef, handleSpeechStart, handleSpeechEnd, onError]);

  /**
   * End the voice call
   */
  const endCall = useCallback(() => {
    if (!isCallActiveRef.current) return;

    console.log('[VoiceCall] Ending call...');
    isCallActiveRef.current = false;

    // Stop VAD
    if (vadRef.current) {
      vadRef.current.pause();
      vadRef.current.destroy();
      vadRef.current = null;
    }

    // Stop any playing audio
    audioPlayerRef.current?.stop();

    // Cleanup audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
      analyserRef.current = null;
    }

    // Signal call end to backend
    wsRef.current?.endVoiceCall();
    wsRef.current?.disableVoice();

    setCallState('idle');
    setCurrentTranscript('');
    setIsMuted(false);
    setTokensUsed(0);
  }, [wsRef, audioPlayerRef]);

  /**
   * Toggle mute state
   */
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newMuted = !prev;
      console.log('[VoiceCall] Mute:', newMuted);
      return newMuted;
    });
  }, []);

  /**
   * Clear insufficient tokens modal
   */
  const clearInsufficientTokens = useCallback(() => {
    setInsufficientTokens(false);
  }, []);

  /**
   * Get analyser node for visualization
   */
  const getAnalyserNode = useCallback((): AnalyserNode | null => {
    // Use audio player's analyser when companion is speaking
    if (callState === 'companion_speaking' && audioPlayerRef.current) {
      return audioPlayerRef.current.getAnalyserNode();
    }
    return analyserRef.current;
  }, [callState, audioPlayerRef]);

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (!wsRef.current) return;

    const ws = wsRef.current;

    // Handle transcription results
    const unsubTranscription = ws.onVoiceTranscription((text, isFinal) => {
      if (!isCallActiveRef.current) return;

      setCurrentTranscript(text);
      onTranscription?.(text, isFinal);

      if (isFinal) {
        console.log('[VoiceCall] Final transcription:', text);
      }
    });

    // Handle TTS playback start
    const unsubTTSChunk = ws.onTTSChunk(() => {
      if (isCallActiveRef.current) {
        setCallState('companion_speaking');
      }
    });

    // Handle TTS playback end
    const unsubTTSEnd = ws.onTTSEnd(() => {
      if (isCallActiveRef.current) {
        setCallState('listening');
        setCurrentTranscript('');
      }
    });

    // Handle voice call started confirmation with balance
    const unsubCallStarted = ws.onVoiceCallStarted((data) => {
      console.log('[VoiceCall] Call confirmed by server, balance:', data.currentBalance);
      if (data.currentBalance !== undefined) {
        setCurrentBalance(data.currentBalance);
      }
    });

    // Handle voice call ended
    const unsubCallEnded = ws.onVoiceCallEnded((data) => {
      console.log('[VoiceCall] Call ended by server, reason:', data.reason, 'tokens used:', data.tokensUsed);
      if (isCallActiveRef.current) {
        endCall();
      }
    });

    // Handle insufficient tokens - call blocked before starting
    const unsubInsufficientTokens = ws.onVoiceCallInsufficientTokens((data) => {
      console.log('[VoiceCall] Insufficient tokens, balance:', data.balance);
      setCurrentBalance(data.balance);
      setInsufficientTokens(true);
      setCallState('idle');
      isCallActiveRef.current = false;
    });

    // Handle balance updates during active call
    const unsubBalanceUpdate = ws.onVoiceCallBalanceUpdate((data) => {
      setCurrentBalance(data.balance);
      setTokensUsed(data.tokensUsed);
    });

    return () => {
      unsubTranscription();
      unsubTTSChunk();
      unsubTTSEnd();
      unsubCallStarted();
      unsubCallEnded();
      unsubInsufficientTokens();
      unsubBalanceUpdate();
    };
  }, [wsRef, onTranscription, endCall]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (vadRef.current) {
        vadRef.current.pause();
        vadRef.current.destroy();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return {
    callState,
    isCallActive,
    isMuted,
    currentTranscript,
    error,
    startCall,
    endCall,
    toggleMute,
    getAnalyserNode,
    // Token billing state
    currentBalance,
    tokensUsed,
    insufficientTokens,
    clearInsufficientTokens,
  };
}
