'use client';

import { useState, useCallback, useRef } from 'react';
import { useConversation } from '@elevenlabs/react';
import { get, apiClient } from '@/lib/api/client';

export type VoiceChatState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';

interface UseVoiceChatOptions {
  companionName: string;
  systemPrompt: string;
  voiceId: string | null;
  firstMessage?: string;
  /** Companion ID for tool calls (image gen, memories) */
  companionId?: string | null;
  /** Session ID for tool calls */
  sessionId?: string | null;
  /** User ID for tool calls */
  userId?: string | null;
  /** Enable lip-sync video generation when agent speaks */
  videoEnabled?: boolean;
  /** Companion anchor avatar URL for lip-sync reference image */
  companionAvatarUrl?: string | null;
  onMessage?: (message: string, role: 'user' | 'assistant') => void;
  onImageGenerated?: (imageUrl: string) => void;
  onError?: (error: string) => void;
}

interface UseVoiceChatReturn {
  voiceState: VoiceChatState;
  isActive: boolean;
  isMuted: boolean;
  setMuted: (muted: boolean) => void;
  agentMessage: string;
  userTranscript: string;
  startChat: () => Promise<void>;
  stopChat: () => Promise<void>;
  error: string | null;
  conversationId: string | null;
  getInputFrequencyData: () => Uint8Array | undefined;
  getOutputFrequencyData: () => Uint8Array | undefined;
  /** Current lip-sync video URL (null when no video ready) */
  currentVideoUrl: string | null;
  /** Whether a lip-sync video is currently being generated */
  isVideoLoading: boolean;
}

interface LipSyncResponse {
  success: boolean;
  data: {
    videoUrl: string;
    duration: number;
  };
}

export function useVoiceChat({
  companionName,
  systemPrompt,
  voiceId,
  firstMessage,
  companionId,
  sessionId,
  userId,
  videoEnabled,
  companionAvatarUrl,
  onMessage,
  onImageGenerated,
  onError,
}: UseVoiceChatOptions): UseVoiceChatReturn {
  const [voiceState, setVoiceState] = useState<VoiceChatState>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [agentMessage, setAgentMessage] = useState('');
  const [userTranscript, setUserTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);

  const intentionalStopRef = useRef(false);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the latest lip-sync request to ignore stale responses
  const lipSyncRequestIdRef = useRef(0);
  // Buffer base64 PCM chunks from ElevenLabs onAudio callback
  const audioChunksRef = useRef<string[]>([]);
  const isCollectingAudioRef = useRef(false);

  // Stable refs for tool dependencies so clientTools object doesn't change
  const companionIdRef = useRef(companionId);
  const sessionIdRef = useRef(sessionId);
  const userIdRef = useRef(userId);
  const onImageGeneratedRef = useRef(onImageGenerated);
  const videoEnabledRef = useRef(videoEnabled);
  const companionAvatarUrlRef = useRef(companionAvatarUrl);
  const voiceIdRef = useRef(voiceId);
  companionIdRef.current = companionId;
  sessionIdRef.current = sessionId;
  userIdRef.current = userId;
  onImageGeneratedRef.current = onImageGenerated;
  videoEnabledRef.current = videoEnabled;
  companionAvatarUrlRef.current = companionAvatarUrl;
  voiceIdRef.current = voiceId;

  /**
   * Request lip-sync video generation for an agent message.
   * Runs async and does not block audio playback.
   */
  const requestLipSyncVideo = useCallback(
    async (text: string) => {
      const cId = companionIdRef.current;
      const vId = voiceIdRef.current;
      if (!cId || !vId) return;

      const requestId = ++lipSyncRequestIdRef.current;
      setIsVideoLoading(true);
      // Don't clear currentVideoUrl — let the player keep looping the previous clip

      try {
        const result = await apiClient<LipSyncResponse>('/lip-sync/generate', {
          method: 'POST',
          body: JSON.stringify({
            text,
            companionId: cId,
            voiceId: vId,
          }),
        });

        // Only apply if this is still the latest request
        if (requestId === lipSyncRequestIdRef.current && result.success) {
          setCurrentVideoUrl(result.data.videoUrl);
        }
        // Don't clear currentVideoUrl on new request — let the player keep looping the last clip
      } catch (err) {
        console.error('[VoiceChat] Lip-sync generation failed:', err);
        // Non-fatal: video just won't play, audio continues fine
      } finally {
        if (requestId === lipSyncRequestIdRef.current) {
          setIsVideoLoading(false);
        }
      }
    },
    []
  );

  /**
   * Request lip-sync video from buffered PCM audio chunks (from onAudio callback).
   * This uses the exact audio the ConvAI agent played, giving perfect lip-sync.
   */
  const requestLipSyncFromAudio = useCallback(
    async (base64Chunks: string[]) => {
      const cId = companionIdRef.current;
      if (!cId || base64Chunks.length === 0) return;

      const requestId = ++lipSyncRequestIdRef.current;
      setIsVideoLoading(true);

      try {
        const result = await apiClient<LipSyncResponse>('/lip-sync/generate-from-audio', {
          method: 'POST',
          body: JSON.stringify({
            companionId: cId,
            audioChunks: base64Chunks,
            sampleRate: 16000, // ElevenLabs ConvAI default PCM format
          }),
        });

        // Only apply if this is still the latest request
        if (requestId === lipSyncRequestIdRef.current && result.success) {
          setCurrentVideoUrl(result.data.videoUrl);
        }
      } catch (err) {
        console.error('[VoiceChat] Lip-sync from audio failed:', err);
        // Non-fatal: video just won't play, audio continues fine
      } finally {
        if (requestId === lipSyncRequestIdRef.current) {
          setIsVideoLoading(false);
        }
      }
    },
    []
  );

  const conversation = useConversation({
    micMuted: isMuted,
    clientTools: {
      generate_image: async (params: Record<string, unknown>) => {
        console.log('[VoiceChat] generate_image called with:', params);
        const cId = companionIdRef.current;
        const sId = sessionIdRef.current;
        const uId = userIdRef.current;
        if (!cId || !sId || !uId) return 'Image generation not available in this session.';
        try {
          const rawPrompt = (params.prompt as string) || 'portrait photo';
          const prompt = `${rawPrompt}. Photorealistic, natural skin texture, real person. NOT a cartoon, illustration, anime, or 3D render.`;
          const result = await apiClient<{ imageUrl: string }>('/imagegen/generate', {
            method: 'POST',
            body: JSON.stringify({
              prompt,
              companionId: cId,
              sessionId: sId,
              userId: uId,
              emotionalState: 'neutral',
              style: 'realistic',
              width: 512,
              height: 768,
            }),
          });
          console.log('[VoiceChat] Image generated:', result.imageUrl);
          onImageGeneratedRef.current?.(result.imageUrl);
          return 'Image generated successfully. The user can see it now.';
        } catch (e) {
          console.error('[VoiceChat] Image generation failed:', e);
          return `Image generation failed: ${e instanceof Error ? e.message : 'unknown error'}`;
        }
      },
      recall_memories: async (params: Record<string, unknown>) => {
        console.log('[VoiceChat] recall_memories called with:', params);
        const cId = companionIdRef.current;
        if (!cId) return 'No memories available.';
        try {
          const query = (params.query as string) || '';
          const result = await apiClient<{ data: { memories: Array<{ content: string; type: string }> } }>(
            `/companions/${cId}/memories?query=${encodeURIComponent(query)}&limit=5`,
          );
          const memories = result.data?.memories || [];
          if (memories.length === 0) return 'No relevant memories found.';
          return memories.map((m) => `[${m.type}] ${m.content}`).join('\n');
        } catch {
          return 'Could not retrieve memories.';
        }
      },
    },
    onUnhandledClientToolCall: (params) => {
      console.warn('[VoiceChat] Unhandled client tool call:', params);
    },
    onAudio: (base64Audio: string) => {
      if (videoEnabledRef.current && isCollectingAudioRef.current) {
        audioChunksRef.current.push(base64Audio);
      }
    },
    onConnect: ({ conversationId: connId }) => {
      setVoiceState('listening');
      setConversationId(connId);
      setError(null);
    },
    onDisconnect: () => {
      if (!intentionalStopRef.current) {
        setError('Connection lost');
        onError?.('Connection lost');
      }
      setVoiceState('idle');
      setConversationId(null);
      setCurrentVideoUrl(null);
      setIsVideoLoading(false);
      audioChunksRef.current = [];
      isCollectingAudioRef.current = false;
    },
    onMessage: (payload) => {
      if (payload.source === 'ai') {
        const cleaned = cleanThinkingBlocks(payload.message);
        if (cleaned) {
          setAgentMessage(cleaned);
          onMessage?.(cleaned, 'assistant');

          // Trigger text-based lip-sync as fallback only when onAudio
          // is not collecting chunks (i.e. no audio-based path available)
          if (videoEnabledRef.current && !isCollectingAudioRef.current) {
            requestLipSyncVideo(cleaned);
          }

          if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
          messageTimerRef.current = setTimeout(() => {
            setAgentMessage('');
          }, 4000);
        }
      } else if (payload.source === 'user') {
        setUserTranscript(payload.message);
        onMessage?.(payload.message, 'user');
      }
    },
    onModeChange: (mode) => {
      if (mode.mode === 'speaking') {
        // Start collecting audio chunks for this utterance
        isCollectingAudioRef.current = true;
        audioChunksRef.current = [];
        setVoiceState('speaking');
        setUserTranscript('');
      } else if (mode.mode === 'listening') {
        setVoiceState('listening');

        // Utterance ended — send collected audio for lip-sync if we have chunks
        if (videoEnabledRef.current && audioChunksRef.current.length > 0) {
          const chunks = [...audioChunksRef.current];
          audioChunksRef.current = [];
          isCollectingAudioRef.current = false;
          requestLipSyncFromAudio(chunks);
        } else {
          // No audio chunks collected — clear video
          isCollectingAudioRef.current = false;
          setCurrentVideoUrl(null);
        }
      }
    },
    onError: (message) => {
      setError(message);
      onError?.(message);
    },
  });

  const startChat = useCallback(async () => {
    if (voiceState !== 'idle') return;

    setError(null);
    setVoiceState('connecting');
    intentionalStopRef.current = false;

    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Get signed URL from gateway
      const response = await get<{ success: boolean; data: { signedUrl: string } }>('/voice/signed-url');
      const signedUrl = response.data.signedUrl;

      // Build overrides for this companion
      const overrides: Record<string, unknown> = {
        agent: {
          prompt: {
            prompt: systemPrompt,
          },
          ...(firstMessage ? { firstMessage } : {}),
        },
      };

      // Override voice if companion has one configured
      if (voiceId) {
        overrides.tts = { voiceId };
      }

      // Start the ElevenLabs conversation
      await conversation.startSession({
        signedUrl,
        overrides,
      } as Parameters<typeof conversation.startSession>[0]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start voice chat';
      setError(message);
      onError?.(message);
      setVoiceState('idle');
    }
  }, [voiceState, systemPrompt, voiceId, firstMessage, conversation, onError]);

  const stopChat = useCallback(async () => {
    intentionalStopRef.current = true;
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    setAgentMessage('');
    setUserTranscript('');
    setCurrentVideoUrl(null);
    setIsVideoLoading(false);
    audioChunksRef.current = [];
    isCollectingAudioRef.current = false;

    try {
      await conversation.endSession();
    } catch {
      // Ignore errors during stop
    }

    setVoiceState('idle');
    setConversationId(null);
  }, [conversation]);

  const getInputFrequencyData = useCallback((): Uint8Array | undefined => {
    return conversation.getInputByteFrequencyData?.() ?? undefined;
  }, [conversation]);

  const getOutputFrequencyData = useCallback((): Uint8Array | undefined => {
    return conversation.getOutputByteFrequencyData?.() ?? undefined;
  }, [conversation]);

  return {
    voiceState,
    isActive: voiceState !== 'idle',
    isMuted,
    setMuted: setIsMuted,
    agentMessage,
    userTranscript,
    startChat,
    stopChat,
    error,
    conversationId,
    getInputFrequencyData,
    getOutputFrequencyData,
    currentVideoUrl,
    isVideoLoading,
  };
}

/**
 * Strip thinking/reasoning blocks from agent messages
 */
function cleanThinkingBlocks(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\*thinking:[\s\S]*?\*/gi, '')
    .replace(/\*reasoning:[\s\S]*?\*/gi, '')
    .replace(/\*internal:[\s\S]*?\*/gi, '')
    .trim();
}
