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
}

export function useVoiceChat({
  companionName,
  systemPrompt,
  voiceId,
  firstMessage,
  companionId,
  sessionId,
  userId,
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

  const intentionalStopRef = useRef(false);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const conversation = useConversation({
    micMuted: isMuted,
    clientTools: {
      generate_image: async (params: { prompt: string }) => {
        if (!companionId || !sessionId || !userId) return 'Image generation not available in this session.';
        try {
          const result = await apiClient<{ imageUrl: string }>('/imagegen/generate', {
            method: 'POST',
            body: JSON.stringify({
              prompt: params.prompt,
              companionId,
              sessionId,
              userId,
              emotionalState: 'neutral',
              style: 'realistic',
              width: 832,
              height: 1248,
            }),
          });
          onImageGenerated?.(result.imageUrl);
          return `Image generated successfully. The user can see it now.`;
        } catch (e) {
          return `Image generation failed: ${e instanceof Error ? e.message : 'unknown error'}`;
        }
      },
      recall_memories: async (params: { query: string }) => {
        if (!companionId || !sessionId) return 'No memories available.';
        try {
          const result = await apiClient<{ data: { memories: Array<{ content: string; type: string }> } }>(
            `/companions/${companionId}/memories?query=${encodeURIComponent(params.query)}&limit=5`,
          );
          const memories = result.data?.memories || [];
          if (memories.length === 0) return 'No relevant memories found.';
          return memories.map((m) => `[${m.type}] ${m.content}`).join('\n');
        } catch {
          return 'Could not retrieve memories.';
        }
      },
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
    },
    onMessage: (payload) => {
      if (payload.source === 'ai') {
        const cleaned = cleanThinkingBlocks(payload.message);
        if (cleaned) {
          setAgentMessage(cleaned);
          onMessage?.(cleaned, 'assistant');

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
        setVoiceState('speaking');
        setUserTranscript('');
      } else if (mode.mode === 'listening') {
        setVoiceState('listening');
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
