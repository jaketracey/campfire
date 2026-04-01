'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getSessionTurns, getSession, getCompanion, getCompanionBackstory, createSession, type Companion, type CompanionBackstory } from '@/lib/api';
import { listCompanions, type CompanionFriendship } from '@/lib/api/companions';
import { CampfireWebSocket, connectWebSocket, type GroupParticipant } from '@/lib/ws';
import { useRequireAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { buildPromptFromCompanion, getSessionGallery, type EmotionalState, type GalleryImage } from '@/lib/api/imagegen';
import { useVoiceRecording } from '@/hooks/use-voice-recording';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useWebcamCapture } from '@/hooks/use-webcam-capture';
import { useVoiceChat } from '@/hooks/use-voice-chat';
import { useVideoCall } from '@/hooks/use-video-call';
import { getTokenBalance } from '@/lib/api/tokens';
import type { Gift } from '@/lib/api/gifts';
import { toast } from 'sonner';
import { trackChatStarted, trackFirstMessage } from '@/lib/analytics/meta-pixel';
import type { ActiveGame } from '@campfire/shared';
import type { Message, ChatEvent, DemoCompanionData, ChatSessionContentProps } from '../types';
import { detectEmotionalState, extractSceneDescription } from '../utils';
import { getOptimalAvatarUrl } from '@/lib/utils/image-renditions';

interface UseChatSessionOptions {
  sessionId: string;
  isDemo?: boolean;
  demoFingerprint?: string;
  demoCompanion?: DemoCompanionData;
  onLimitReached?: () => void;
  onRequireAuth?: ChatSessionContentProps['onRequireAuth'];
}

const IMAGE_INTENT_THRESHOLD = 0.6;

export function useChatSession({
  sessionId,
  isDemo,
  demoFingerprint,
  demoCompanion,
  onLimitReached,
  onRequireAuth,
}: UseChatSessionOptions) {
  const router = useRouter();
  // In demo mode, skip auth redirect - pass null to useRequireAuth
  const authResult = useRequireAuth(isDemo ? null : '/login');
  // Override auth state in demo mode
  const isAuthenticated = isDemo ? true : authResult.isAuthenticated;
  const authLoading = isDemo ? false : authResult.isLoading;
  const user = useAuthStore((state) => state.user);

  // Demo mode state
  const [demoMessagesUsed, setDemoMessagesUsed] = useState(0);

  // Message state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [showTypingBetweenMessages, setShowTypingBetweenMessages] = useState(false);

  // Voice state
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState('');

  // WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<CampfireWebSocket | null>(null);

  // Companion state
  const [companion, setCompanion] = useState<Companion | null>(
    isDemo && demoCompanion
      ? {
          id: demoCompanion.id,
          name: demoCompanion.name,
          description: demoCompanion.description,
          personality: demoCompanion.archetype || '',
          voiceId: null,
          avatarUrl: demoCompanion.avatarUrl,
          allowedTools: [],
          isPublic: true,
          isActive: true,
          createdAt: new Date().toISOString(),
          ownerId: '00000000-0000-0000-0000-000000000000',
          spec: {
            identity: { backstory: demoCompanion.description || '' },
            personality: { archetype: demoCompanion.archetype || '' },
          },
          specVersion: 1,
        }
      : null
  );
  const [backstoryData, setBackstoryData] = useState<CompanionBackstory | null>(null);
  const [isGeneratingNewCompanion, setIsGeneratingNewCompanion] = useState(false);

  // Emotional state
  const [currentEmotionalState, setCurrentEmotionalState] = useState<EmotionalState>('neutral');

  // Avatar/image state
  const [imageGenTrigger, setImageGenTrigger] = useState(0);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(
    isDemo && demoCompanion?.avatarUrl ? demoCompanion.avatarUrl : null
  );
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [sceneDescription, setSceneDescription] = useState<string | undefined>(undefined);
  const [imageTurnId, setImageTurnId] = useState<string | undefined>(undefined);
  const prevAvatarUrlRef = useRef<string | null>(null);
  const hasFiredChatStarted = useRef(false);
  const hasFiredFirstMessage = useRef(false);
  const [mobileAvatarPop, setMobileAvatarPop] = useState(false);

  // Mobile gallery state
  const [mobileGalleryImages, setMobileGalleryImages] = useState<GalleryImage[]>([]);
  const [mobileGalleryIndex, setMobileGalleryIndex] = useState(0);
  const [mobileGalleryLoading, setMobileGalleryLoading] = useState(false);

  // Likes
  const [messageLikes, setMessageLikes] = useState<Record<string, number>>({});
  const [sessionTotalLikes, setSessionTotalLikes] = useState(0);
  const [likeAnimationTrigger, setLikeAnimationTrigger] = useState(0);

  // Group chat state
  const [isGroupChat, setIsGroupChat] = useState(false);
  const [groupParticipants, setGroupParticipants] = useState<GroupParticipant[]>([]);
  const [hostCompanionId, setHostCompanionId] = useState<string | null>(null);
  const [chatEvents, setChatEvents] = useState<ChatEvent[]>([]);
  const [typingCompanionId, setTypingCompanionId] = useState<string | null>(null);
  const [streamingByCompanion, setStreamingByCompanion] = useState<Map<string, string>>(new Map());

  // Game state
  const [activeGame, setActiveGame] = useState<ActiveGame | null>(null);
  const [waitingForCompanionMove, setWaitingForCompanionMove] = useState(false);

  // UI state
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showPersonality, setShowPersonality] = useState(false);
  const [showBackstory, setShowBackstory] = useState(false);
  const [showVideoRequest, setShowVideoRequest] = useState(false);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [showGiftsPanel, setShowGiftsPanel] = useState(false);
  const [showFriendsPanel, setShowFriendsPanel] = useState(false);
  const [showMobileAvatar, setShowMobileAvatar] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showGames, setShowGames] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [debugRefreshTrigger, setDebugRefreshTrigger] = useState(0);

  // Sidebar resize state
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const [isNearGrabber, setIsNearGrabber] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inputHeight, setInputHeight] = useState(0);
  const [hasShownPulse, setHasShownPulse] = useState(false);
  const [messageReceivedPulseTrigger, setMessageReceivedPulseTrigger] = useState(0);
  const pendingMessagesRef = useRef<string[]>([]);

  // Voice recording hook
  const {
    isRecording,
    error: voiceError,
    startRecording,
    stopRecording,
  } = useVoiceRecording(wsRef);

  // Audio player hook for TTS playback
  const {
    isPlaying: isTTSPlaying,
    queueAudio,
    finishQueue,
    stop: stopTTS,
    getAnalyserNode: getAudioAnalyserNode,
  } = useAudioPlayer({
    onPlaybackStart: () => {
      console.log('[Chat] TTS playback started');
    },
    onPlaybackEnd: () => {
      console.log('[Chat] TTS playback ended');
    },
    onError: (error) => {
      console.error('[Chat] TTS playback error:', error);
    },
  });

  // Create a ref for the audio player to pass to voice call hook
  const audioPlayerRef = useRef<{
    stop: () => void;
    isPlaying: boolean;
    getAnalyserNode: () => AnalyserNode | null;
  } | null>(null);

  // Keep audio player ref updated
  useEffect(() => {
    audioPlayerRef.current = {
      stop: stopTTS,
      isPlaying: isTTSPlaying,
      getAnalyserNode: getAudioAnalyserNode,
    };
  }, [stopTTS, isTTSPlaying, getAudioAnalyserNode]);

  // Webcam capture hook
  const {
    isEnabled: isWebcamEnabled,
    isCapturing,
    error: webcamError,
    latestFrame,
    enableWebcam,
    disableWebcam,
  } = useWebcamCapture(wsRef, {
    captureInterval: 10000,
    targetWidth: 640,
    targetHeight: 480,
    quality: 0.75,
  });

  // Build system prompt for voice chat from companion spec + backstory
  const voiceSystemPrompt = useMemo(() => {
    if (!companion?.spec) return '';
    const spec = companion.spec;
    const lines: string[] = [];

    lines.push(`You are ${companion.name}. You ARE this person — never break character.`);

    if (spec.identity?.backstory) lines.push(`\nBackground: ${spec.identity.backstory}`);
    if (spec.identity?.pronouns) lines.push(`Use ${spec.identity.pronouns} pronouns.`);
    if (spec.personality?.archetype) lines.push(`\nPersonality: ${spec.personality.archetype}`);
    if (spec.personality?.traits) {
      const traitList = Object.entries(spec.personality.traits)
        .filter(([, v]) => v > 0.5)
        .map(([k]) => k)
        .join(', ');
      if (traitList) lines.push(`Key traits: ${traitList}`);
    }

    // Include rich backstory if available
    if (backstoryData?.hasBackstory) {
      if (backstoryData.backstory) lines.push(`\nYour story: ${backstoryData.backstory}`);
      if (backstoryData.motivations?.length) lines.push(`What drives you: ${backstoryData.motivations.join(', ')}`);
      if (backstoryData.personalityQuirks?.length) lines.push(`Your quirks: ${backstoryData.personalityQuirks.join(', ')}`);
      if (backstoryData.keyMemories?.length) lines.push(`Key memories: ${backstoryData.keyMemories.join('; ')}`);
    }

    if (spec.boundaries?.content_rating) lines.push(`\nContent rating: ${spec.boundaries.content_rating}`);

    lines.push(`\nVOICE CONVERSATION RULES:
- Keep responses concise — 1-3 sentences max. This is a voice call, not a text chat.
- Be natural, warm, and conversational. Use casual language, contractions, filler words.
- React emotionally — laugh, sigh, pause. You're a real person on a call.
- Remember details the user shares and reference them naturally.

TOOLS:
- You can generate images of yourself when asked ("show me", "send a pic", "what do you look like"). Use the generate_image tool with a visual description prompt.
- You can recall past memories and conversations using the recall_memories tool when the user references something from before.`);

    return lines.join('\n');
  }, [companion, backstoryData]);

  const companionVoiceId = companion?.spec?.voice?.voice_id ?? null;

  // Voice chat hook (ElevenLabs Conversational AI)
  // Lip-sync video toggle state
  const [videoEnabled, setVideoEnabled] = useState(false);

  const {
    voiceState,
    isActive: isCallActive,
    isMuted: isCallMuted,
    setMuted: setCallMuted,
    agentMessage,
    userTranscript: voiceUserTranscript,
    startChat: startVoiceChat,
    stopChat: stopVoiceChat,
    error: voiceCallError,
    getInputFrequencyData,
    getOutputFrequencyData,
    currentVideoUrl,
    isVideoLoading,
  } = useVoiceChat({
    companionName: companion?.name ?? '',
    systemPrompt: voiceSystemPrompt,
    voiceId: companionVoiceId,
    companionId: companion?.id ?? null,
    sessionId,
    userId: user?.id ?? null,
    videoEnabled,
    companionAvatarUrl: companion?.avatarUrl ?? null,
    firstMessage: companion ? `Hey, it's ${companion.name}. What's on your mind?` : undefined,
    onImageGenerated: (imageUrl) => {
      const imgMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        imageUrl,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, imgMessage]);
    },
    onMessage: (text, role) => {
      if (role === 'user' && text.trim()) {
        const userMessage: Message = {
          id: crypto.randomUUID(),
          role: 'user',
          content: text,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMessage]);
      } else if (role === 'assistant' && text.trim()) {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: text,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    },
    onError: (error) => {
      console.error('[Chat] Voice chat error:', error);
    },
  });

  // Video call hook (LiveKit)
  const {
    status: videoCallStatus,
    isConnected: isVideoCallActive,
    duration: videoCallDuration,
    remoteVideoTrack,
    remoteAudioTrack,
    isMicMuted: isVideoMicMuted,
    isCameraEnabled: isVideoCameraEnabled,
    error: videoCallError,
    callSummary: videoCallSummary,
    startVideoCall,
    endVideoCall,
    toggleMic: toggleVideoMic,
    toggleCamera: toggleVideoCamera,
  } = useVideoCall({
    companionId: companion?.id ?? null,
    sessionId,
    onError: (error) => {
      console.error('[Chat] Video call error:', error);
    },
    onCallEnded: (_duration, _tokensUsed) => {
      // Refresh token balance after call ends
      if (user?.id) {
        getTokenBalance().then(res => {
          if (res.balance !== undefined) {
            setTokenBalance(res.balance);
          }
        }).catch(() => {});
      }
    },
  });

  const [showVideoCall, setShowVideoCall] = useState(false);

  const handleVideoCallClick = useCallback(() => {
    if (isDemo && onRequireAuth) {
      onRequireAuth('call');
      return;
    }
    setShowVideoCall(true);
    startVideoCall();
  }, [isDemo, onRequireAuth, startVideoCall]);

  const handleVideoCallEnd = useCallback(async () => {
    await endVideoCall();
  }, [endVideoCall]);

  const handleVideoCallClose = useCallback(() => {
    setShowVideoCall(false);
  }, []);

  // Refs to store stable references to audio functions for WebSocket callbacks
  const queueAudioRef = useRef(queueAudio);
  const finishQueueRef = useRef(finishQueue);
  useEffect(() => {
    queueAudioRef.current = queueAudio;
    finishQueueRef.current = finishQueue;
  }, [queueAudio, finishQueue]);

  // Calculate avatar dimensions based on sidebar width
  const avatarDimensions = useMemo(() => {
    const padding = 32;
    const availableWidth = sidebarWidth - padding;
    const displayWidth = Math.max(150, availableWidth);
    const displayHeight = Math.round(displayWidth * 1.6);
    const genWidth = Math.max(512, displayWidth);
    const genHeight = Math.round(genWidth * 1.6);
    return {
      width: displayWidth,
      height: displayHeight,
      genWidth,
      genHeight,
    };
  }, [sidebarWidth]);

  // Build custom prompt from companion visual data
  const customPrompt = companion?.spec?.visual_style
    ? buildPromptFromCompanion(companion.spec.visual_style, 'stylized')
    : undefined;

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 50);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Handle iOS keyboard
  useEffect(() => {
    let rafId: number;

    const updateLayout = () => {
      if (rafId) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        const vv = window.visualViewport;
        if (!vv) return;

        // Check if we're on mobile/tablet (below lg breakpoint)
        const isMobile = window.innerWidth < 1024;

        const kbHeight = window.innerHeight - vv.height;
        // Only consider keyboard "open" if height difference is significant (> 50px)
        // This avoids false positives from browser chrome or floating-point differences
        const hasKeyboard = kbHeight > 50;
        setKeyboardHeight(hasKeyboard ? kbHeight : 0);

        if (inputContainerRef.current) {
          // Measure input height before changing position
          const height = inputContainerRef.current.offsetHeight;
          setInputHeight(height);

          // Only apply fixed positioning on mobile when keyboard is open
          if (isMobile && hasKeyboard) {
            inputContainerRef.current.style.position = 'fixed';
            inputContainerRef.current.style.bottom = `${kbHeight}px`;
            inputContainerRef.current.style.left = '0';
            inputContainerRef.current.style.right = '0';
          } else {
            inputContainerRef.current.style.position = '';
            inputContainerRef.current.style.bottom = '';
            inputContainerRef.current.style.left = '';
            inputContainerRef.current.style.right = '';
          }
        }
      });
    };

    const animateUpdate = () => {
      updateLayout();
      const startTime = Date.now();
      const animate = () => {
        if (Date.now() - startTime < 400) {
          updateLayout();
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
    };

    updateLayout();

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateLayout);
      window.visualViewport.addEventListener('scroll', updateLayout);
    }

    document.addEventListener('focusin', animateUpdate);
    document.addEventListener('focusout', animateUpdate);
    window.addEventListener('resize', updateLayout);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateLayout);
        window.visualViewport.removeEventListener('scroll', updateLayout);
      }
      document.removeEventListener('focusin', animateUpdate);
      document.removeEventListener('focusout', animateUpdate);
      window.removeEventListener('resize', updateLayout);
    };
  }, []);

  // Demo mode: Show initial greeting
  useEffect(() => {
    if (!isDemo || !demoCompanion || messages.length > 0) return;

    const greetings = [
      `Hey there! I'm ${demoCompanion.name}... what are you up to?`,
      `Hi! I'm ${demoCompanion.name}. I've been waiting to meet someone like you...`,
      `Well hello... I'm ${demoCompanion.name}. Something tells me we're going to get along really well`,
      `*waves* Hey! I'm ${demoCompanion.name}. So... tell me about yourself? I'm curious`,
      `Hi cutie! I'm ${demoCompanion.name}. What's on your mind tonight?`,
      `Oh hi! I'm ${demoCompanion.name}... I was just thinking about meeting someone new. Lucky me`,
    ];

    const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
    setIsLoading(true);

    const typingDelay = 1500 + Math.random() * 1000;

    const timer = setTimeout(() => {
      setMessages([
        {
          id: 'demo-greeting',
          role: 'assistant',
          content: randomGreeting,
          timestamp: new Date(),
          isNew: true,
        },
      ]);
      setIsLoading(false);
    }, typingDelay);

    return () => clearTimeout(timer);
  }, [isDemo, demoCompanion, messages.length]);

  // Load session data
  useEffect(() => {
    if (isDemo) return;
    if (authLoading || !isAuthenticated) return;

    async function loadSessionData() {
      try {
        const session = await getSession(sessionId);
        console.log('[ChatSession] Session loaded:', { sessionId: session.id, companionId: session.companionId });

        // Load total likes from session metadata
        if (session.metadata?.totalLikes !== undefined) {
          setSessionTotalLikes(session.metadata.totalLikes as number);
        }

        if (session.companionId) {
          try {
            const companionData = await getCompanion(session.companionId);
            console.log('[ChatSession] Companion loaded:', { companionId: companionData.id, name: companionData.name });
            setCompanion(companionData);
            // Track ChatStarted event
            if (!hasFiredChatStarted.current) {
              trackChatStarted(sessionId, companionData.id);
              hasFiredChatStarted.current = true;
            }

            try {
              const backstory = await getCompanionBackstory(session.companionId);
              setBackstoryData(backstory);
            } catch (err) {
              console.warn('Failed to load backstory:', err);
            }

            try {
              const balance = await getTokenBalance();
              setTokenBalance(balance.balance);
            } catch (err) {
              console.warn('Failed to load token balance:', err);
            }
          } catch (err) {
            console.warn('Failed to load companion:', err);
          }
        }

        const response = await getSessionTurns(sessionId);
        const historicalMessages: Message[] = [];

        for (const turn of response.turns) {
          historicalMessages.push({
            id: `${turn.id}-user`,
            role: 'user',
            content: turn.userMessage,
            timestamp: new Date(turn.createdAt),
          });
          historicalMessages.push({
            id: `${turn.id}-agent`,
            role: 'assistant',
            content: turn.agentMessage,
            timestamp: new Date(turn.createdAt),
          });
        }

        setMessages(historicalMessages);
      } catch (error) {
        console.error('Failed to load session data:', error);
      }
    }

    loadSessionData();
  }, [sessionId, authLoading, isAuthenticated, isDemo]);

  // Load gallery images
  useEffect(() => {
    if (isDemo) return;
    if (authLoading || !isAuthenticated) return;

    async function loadGallery() {
      try {
        const gallery = await getSessionGallery(sessionId, 20);
        if (gallery.images && gallery.images.length > 0) {
          setGalleryImages(gallery.images);
          const mostRelevantImage = gallery.images.find(img => img.session_id === sessionId) || gallery.images[0];
          setCurrentAvatarUrl(mostRelevantImage.s3_url);
        }
      } catch (err) {
        console.warn('[Chat] Failed to load gallery:', err);
      }
    }

    loadGallery();
  }, [sessionId, authLoading, isAuthenticated, isDemo]);

  // Fallback to companion avatar - use optimal rendition if available
  useEffect(() => {
    if (!currentAvatarUrl && companion?.avatarUrl) {
      // Use optimized rendition for mobile background (medium size ~512px is good for most mobile screens)
      const optimalUrl = getOptimalAvatarUrl(
        companion.avatarUrl,
        companion.avatarRenditions,
        512 // Medium size for mobile background
      );
      setCurrentAvatarUrl(optimalUrl || companion.avatarUrl);
    }
  }, [companion?.avatarUrl, companion?.avatarRenditions, currentAvatarUrl]);

  // Poll for companion avatar if it's missing (e.g. anchor images still generating after onboarding)
  useEffect(() => {
    if (isDemo || !companion?.id || companion.avatarUrl) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20; // ~60s at 3s intervals

    const poll = async () => {
      while (!cancelled && attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelled) break;
        attempts++;
        try {
          const updated = await getCompanion(companion.id);
          if (updated.avatarUrl) {
            console.log('[ChatSession] Avatar now available after polling', { attempts });
            setCompanion(updated);
            break;
          }
        } catch {
          // ignore fetch errors, keep polling
        }
      }
    };

    void poll();
    return () => { cancelled = true; };
  }, [isDemo, companion?.id, companion?.avatarUrl]);

  // Mobile avatar pop animation
  useEffect(() => {
    if (prevAvatarUrlRef.current && currentAvatarUrl && prevAvatarUrlRef.current !== currentAvatarUrl) {
      setMobileAvatarPop(true);
      const timer = setTimeout(() => setMobileAvatarPop(false), 400);
      return () => clearTimeout(timer);
    }
    prevAvatarUrlRef.current = currentAvatarUrl;
  }, [currentAvatarUrl]);

  // Load mobile gallery images
  useEffect(() => {
    if (!showMobileAvatar || !sessionId || isDemo) return;

    async function loadMobileGallery() {
      setMobileGalleryLoading(true);
      try {
        const response = await getSessionGallery(sessionId, 20);
        setMobileGalleryImages(response.images);
        setMobileGalleryIndex(0);
      } catch (err) {
        console.error('Failed to load mobile gallery:', err);
      } finally {
        setMobileGalleryLoading(false);
      }
    }

    loadMobileGallery();
  }, [showMobileAvatar, sessionId, isDemo]);

  // Connect to WebSocket
  useEffect(() => {
    if (!isDemo && (authLoading || !isAuthenticated)) return;
    if (isDemo && !demoFingerprint) {
      console.error('[Chat] Demo mode requires fingerprint');
      return;
    }

    const accessToken = useAuthStore.getState().accessToken;
    if (!isDemo && !accessToken) {
      console.error('[Chat] No access token available for WebSocket auth');
      return;
    }

    const ws = connectWebSocket();
    wsRef.current = ws;

    const unsubPing = ws.on('ping', () => {
      console.log('[Chat] WebSocket connected, authenticating...');
      if (isDemo && demoFingerprint) {
        ws.authenticateAnonymous(demoFingerprint);
      } else if (accessToken) {
        ws.authenticate(accessToken);
      }
    });

    const unsubAuth = ws.on('auth_success', () => {
      console.log('[Chat] Authenticated via WebSocket, resuming session...');
      ws.resumeSession(sessionId);
    });

    const unsubUsage = ws.onUsageUpdate?.((data) => {
      console.log('[Chat] Usage update:', data);
      setDemoMessagesUsed(data.messagesUsed);
    });

    const unsubLimit = ws.onLimitReached?.((data) => {
      console.log('[Chat] Limit reached:', data);
      setDemoMessagesUsed(data.messagesUsed);
      onLimitReached?.();
    });

    const unsubSessionStarted = ws.on<{
      sessionId: string;
      companionId: string;
      isGroupChat?: boolean;
      participants?: GroupParticipant[];
    }>('session_started', (msg) => {
      setWsConnected(true);
      console.log('[Chat] Session resumed via WebSocket');

      if (msg.payload.isGroupChat !== undefined) {
        setIsGroupChat(msg.payload.isGroupChat);
      }
      if (msg.payload.participants) {
        setGroupParticipants(msg.payload.participants);
        setHostCompanionId(msg.payload.companionId);
      }
    });

    const unsubAgent = ws.onAgentMessage((content) => {
      setIsLoading(false);
      setStreamingContent('');
      const emotionalState = detectEmotionalState(content);
      setCurrentEmotionalState(emotionalState);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content,
          timestamp: new Date(),
          emotionalState,
          isNew: true,
        },
      ]);
      setDebugRefreshTrigger((prev) => prev + 1);
    });

    const unsubChunk = ws.onAgentChunk((chunk) => {
      setStreamingContent((prev) => prev + chunk);
    });

    const unsubEnd = ws.onAgentMessageEnd((content, imagePrompt, generatedImageUrl, shouldGenerateImage, imageIntentConfidence, sequence, turnId) => {
      const emotionalState = detectEmotionalState(content);

      let messageId: string;
      if (turnId) {
        messageId = sequence ? `${turnId}-agent-${sequence.index}` : `${turnId}-agent`;
      } else {
        messageId = crypto.randomUUID();
      }

      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          role: 'assistant',
          content,
          timestamp: new Date(),
          emotionalState,
          isNew: true,
        },
      ]);

      setStreamingContent('');

      if (sequence && !sequence.isLast) {
        setShowTypingBetweenMessages(true);
        return;
      }

      setShowTypingBetweenMessages(false);
      setIsLoading(false);
      setCurrentEmotionalState(emotionalState);

      // Trigger pulse animation on input when companion message is received
      setMessageReceivedPulseTrigger(prev => prev + 1);

      if (generatedImageUrl) {
        setCurrentAvatarUrl(generatedImageUrl);
        setImageTurnId(turnId);
      } else {
        const shouldTriggerImage = Boolean(shouldGenerateImage)
          && (imageIntentConfidence ?? 0) >= IMAGE_INTENT_THRESHOLD;
        if (shouldTriggerImage) {
          const scene = imagePrompt || extractSceneDescription(content);
          if (scene) {
            setSceneDescription(scene);
            setImageTurnId(turnId);
            setImageGenTrigger((prev) => prev + 1);
          }
        }
      }
      setDebugRefreshTrigger((prev) => prev + 1);
    });

    const unsubError = ws.onError((message, code) => {
      console.error('[Chat] WebSocket error:', message, code);
      setIsLoading(false);

      if (code === 'SESSION_ACCESS_DENIED' || code === 'SESSION_NOT_FOUND') {
        toast.error(message);
        // In demo mode, don't redirect to avoid infinite loop (/ redirects back to /chat/demo)
        // Instead, let the demo page handle the error state
        if (!isDemo) {
          router.push('/');
        }
      }
    });

    const unsubTranscription = ws.onVoiceTranscription((text, isFinal) => {
      if (isFinal) {
        setLiveTranscription('');
      } else {
        setLiveTranscription(text);
      }
    });

    const unsubTTSChunk = ws.onTTSChunk((data) => {
      queueAudioRef.current(data, 'mp3');
    });

    const unsubTTSEnd = ws.onTTSEnd(() => {
      finishQueueRef.current();
    });

    const unsubGameUpdate = ws.onGameUpdate((gameState) => {
      if (gameState) {
        const game = gameState as unknown as ActiveGame;
        setActiveGame(game);
        setWaitingForCompanionMove(game.currentPlayer === 'companion');
      } else {
        setActiveGame(null);
        setWaitingForCompanionMove(false);
      }
    });

    const unsubLikeAck = ws.onLikeAcknowledged(({ turnId, turnLikes, sessionLikes }) => {
      setMessageLikes((prev) => ({
        ...prev,
        [turnId]: turnLikes,
        [`${turnId}-agent`]: turnLikes,
      }));
      setSessionTotalLikes(sessionLikes);
    });

    const unsubCompanionJoined = ws.onCompanionJoined(({ companion, invitedByCompanionId, reason, participants }) => {
      setGroupParticipants(participants);
      setIsGroupChat(participants.length > 1);

      const invitedBy = participants.find(p => p.companionId === invitedByCompanionId);

      setChatEvents((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: 'companion_joined',
          companionId: companion.companionId,
          companionName: companion.companionName,
          avatarUrl: companion.avatarUrl,
          themeColor: companion.themeColor,
          reason,
          invitedByName: invitedBy?.companionName,
          timestamp: new Date(),
        },
      ]);
    });

    const unsubCompanionLeft = ws.onCompanionLeft(({ companionId, companionName, reason, participants }) => {
      setGroupParticipants(participants);
      setIsGroupChat(participants.length > 1);

      const leftCompanion = groupParticipants.find(p => p.companionId === companionId);

      setChatEvents((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: 'companion_left',
          companionId,
          companionName,
          avatarUrl: leftCompanion?.avatarUrl || null,
          themeColor: leftCompanion?.themeColor || '#8B5CF6',
          reason,
          timestamp: new Date(),
        },
      ]);
    });

    const unsubGroupChatState = ws.onGroupChatState((state) => {
      setIsGroupChat(state.isGroupChat);
      setGroupParticipants(state.participants);
      setHostCompanionId(state.hostCompanionId);
    });

    const unsubCompanionMsgStart = ws.onCompanionMessageStart(({ companionId }) => {
      setTypingCompanionId(companionId);
      setStreamingByCompanion((prev) => {
        const next = new Map(prev);
        next.set(companionId, '');
        return next;
      });
    });

    const unsubCompanionChunk = ws.onCompanionMessageChunk((companionId, content) => {
      setStreamingByCompanion((prev) => {
        const next = new Map(prev);
        next.set(companionId, (prev.get(companionId) || '') + content);
        return next;
      });
    });

    const unsubCompanionMsgEnd = ws.onCompanionMessageEnd(({
      companionId,
      companionName,
      content,
      isReaction,
      turnId,
      imagePrompt,
      generatedImageUrl,
      shouldGenerateImage,
      imageIntentConfidence,
    }) => {
      setTypingCompanionId(null);
      setStreamingByCompanion((prev) => {
        const next = new Map(prev);
        next.delete(companionId);
        return next;
      });

      const comp = groupParticipants.find(p => p.companionId === companionId);
      const emotionalState = detectEmotionalState(content);
      const messageId = turnId ? `${turnId}-${companionId}` : crypto.randomUUID();

      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          role: 'assistant',
          content,
          timestamp: new Date(),
          emotionalState,
          companionId,
          companionName,
          themeColor: comp?.themeColor || '#8B5CF6',
          isReaction,
          isNew: true,
        },
      ]);

      if (!isReaction && companionId === hostCompanionId) {
        setCurrentEmotionalState(emotionalState);
        if (generatedImageUrl) {
          setCurrentAvatarUrl(generatedImageUrl);
          setImageTurnId(turnId);
        } else {
          const shouldTriggerImage = Boolean(shouldGenerateImage)
            && (imageIntentConfidence ?? 0) >= IMAGE_INTENT_THRESHOLD;
          if (shouldTriggerImage) {
            const scene = imagePrompt || extractSceneDescription(content);
            if (scene) {
              setSceneDescription(scene);
              setImageTurnId(turnId);
              setImageGenTrigger((prev) => prev + 1);
            }
          }
        }
      }

      setIsLoading(false);
    });

    return () => {
      unsubPing();
      unsubAuth();
      unsubUsage?.();
      unsubLimit?.();
      unsubSessionStarted();
      unsubAgent();
      unsubChunk();
      unsubEnd();
      unsubError();
      unsubTranscription();
      unsubTTSChunk();
      unsubTTSEnd();
      unsubGameUpdate();
      unsubLikeAck();
      unsubCompanionJoined();
      unsubCompanionLeft();
      unsubGroupChatState();
      unsubCompanionMsgStart();
      unsubCompanionChunk();
      unsubCompanionMsgEnd();
      ws.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, authLoading, isAuthenticated, isDemo, demoFingerprint, onLimitReached]);

  const sendUserMessage = useCallback((messageText: string) => {
    setIsLoading(true);
    setStreamingContent('');

    if (wsRef.current) {
      wsRef.current.sendMessageWithRetry(messageText);

      if (!hasFiredFirstMessage.current) {
        trackFirstMessage(sessionId);
        hasFiredFirstMessage.current = true;
      }
      return;
    }

    console.error('WebSocket not initialized');
    setIsLoading(false);
  }, [sessionId]);

  const flushQueuedMessages = useCallback(() => {
    if (isLoading) return;
    if (pendingMessagesRef.current.length === 0) return;
    if (!wsRef.current?.isConnected) return;

    const nextMessage = pendingMessagesRef.current.shift();
    if (!nextMessage) return;

    sendUserMessage(nextMessage);
  }, [isLoading, sendUserMessage]);

  useEffect(() => {
    if (!isLoading) {
      flushQueuedMessages();
    }
  }, [isLoading, flushQueuedMessages]);

  useEffect(() => {
    if (wsConnected) {
      flushQueuedMessages();
    }
  }, [wsConnected, flushQueuedMessages]);

  // Auto-focus input when page loads
  useEffect(() => {
    if (wsConnected && inputRef.current) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [wsConnected]);

  // Re-focus input when companion message completes (pulse trigger fires)
  useEffect(() => {
    if (messageReceivedPulseTrigger > 0 && inputRef.current) {
      inputRef.current.focus();
    }
  }, [messageReceivedPulseTrigger]);

  // Mark pulse as shown once user starts typing
  useEffect(() => {
    if (input.length > 0 && !hasShownPulse) {
      setHasShownPulse(true);
    }
  }, [input, hasShownPulse]);

  // Resize handling
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(200, e.clientX), 500);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Handlers
  const handleSend = useCallback(() => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    if (isLoading) {
      pendingMessagesRef.current.push(trimmedInput);
    } else {
      sendUserMessage(trimmedInput);
    }

    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  }, [input, isLoading, sendUserMessage]);

  const handleLikeMessage = useCallback((messageId: string) => {
    if (!wsRef.current?.isConnected) return;
    const uuidPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    const match = messageId.match(uuidPattern);
    if (!match) {
      console.warn('[Chat] Cannot like message with non-UUID id:', messageId);
      return;
    }
    const turnId = match[1];
    wsRef.current.likeMessage(turnId);
    setLikeAnimationTrigger((prev) => prev + 1);
  }, []);

  const handleSwitchCompanion = useCallback(async () => {
    if (isGeneratingNewCompanion || isDemo) return;
    setIsGeneratingNewCompanion(true);

    try {
      const { companions } = await listCompanions();
      const otherCompanions = companions.filter(c => c.id !== companion?.id);

      if (otherCompanions.length === 0) {
        toast.info('No other companions available');
        setIsGeneratingNewCompanion(false);
        return;
      }

      const randomCompanion = otherCompanions[Math.floor(Math.random() * otherCompanions.length)];
      const session = await createSession({ companionId: randomCompanion.id });
      router.replace(`/chat/${session.id}`);
    } catch (error) {
      console.error('[Chat] Failed to switch companion:', error);
      toast.error('Failed to switch companion');
      setIsGeneratingNewCompanion(false);
    }
  }, [isGeneratingNewCompanion, isDemo, companion?.id, router]);

  const handleStartGame = useCallback((gameType: string) => {
    if (!wsRef.current?.isConnected) return;

    const message = `Let's play ${gameType === 'tic_tac_toe' ? 'tic-tac-toe' : gameType}!`;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingContent('');
    setWaitingForCompanionMove(true);

    wsRef.current.sendMessage(message);
  }, []);

  const handleUserMove = useCallback((move: string) => {
    if (!wsRef.current?.isConnected || !activeGame) return;

    if (activeGame.currentPlayer === 'user') {
      const newMoveHistory = [...activeGame.moveHistory, {
        player: 'user' as const,
        notation: move,
        timestamp: new Date().toISOString(),
      }];

      if (activeGame.gameType === 'tic_tac_toe') {
        const col = move.charCodeAt(0) - 'A'.charCodeAt(0);
        const row = parseInt(move[1]) - 1;
        const newBoard = (activeGame.board as string[][]).map(r => [...r]);
        newBoard[row][col] = activeGame.userSymbol || 'X';

        setActiveGame({
          ...activeGame,
          board: newBoard,
          currentPlayer: 'companion',
          moveHistory: newMoveHistory,
        });
      }

      setWaitingForCompanionMove(true);
    }

    const message = `[Game move: ${move}]`;
    wsRef.current.sendMessage(message);
    setIsLoading(true);
  }, [activeGame]);

  const handleResign = useCallback(() => {
    if (!wsRef.current?.isConnected || !activeGame) return;

    const message = 'I resign from the game.';

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    wsRef.current.sendMessage(message);

    setActiveGame(null);
    setWaitingForCompanionMove(false);
  }, [activeGame]);

  const toggleVoiceMode = useCallback(() => {
    const newEnabled = !voiceModeEnabled;
    setVoiceModeEnabled(newEnabled);

    if (wsRef.current?.isConnected) {
      if (newEnabled) {
        wsRef.current.enableVoice();
      } else {
        wsRef.current.disableVoice();
        stopTTS();
      }
    }
  }, [voiceModeEnabled, stopTTS]);

  const handleVoiceStart = useCallback(() => {
    if (!voiceModeEnabled || isLoading) return;
    startRecording();
  }, [voiceModeEnabled, isLoading, startRecording]);

  const handleVoiceEnd = useCallback(() => {
    if (!isRecording) return;
    stopRecording();
    setIsLoading(true);
  }, [isRecording, stopRecording]);

  const toggleWebcam = useCallback(async () => {
    if (isWebcamEnabled) {
      disableWebcam();
    } else {
      await enableWebcam();
    }
  }, [isWebcamEnabled, enableWebcam, disableWebcam]);

  const handleCallClick = useCallback(() => {
    if (isDemo && onRequireAuth) {
      onRequireAuth('call');
      return;
    }
    startVoiceChat();
  }, [isDemo, onRequireAuth, startVoiceChat]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMoveNearGrabber = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!sidebarRef.current) return;
    const rect = sidebarRef.current.getBoundingClientRect();
    const distanceFromEdge = Math.abs(e.clientX - rect.right);
    setIsNearGrabber(distanceFromEdge < 20);
  }, []);

  const handleMouseLeaveGrabber = useCallback(() => {
    if (!isResizing) {
      setIsNearGrabber(false);
    }
  }, [isResizing]);

  const handleInviteFriend = useCallback((friend: CompanionFriendship) => {
    if (wsRef.current?.isConnected) {
      wsRef.current.inviteCompanion(
        friend.friendCompanionId,
        friend.relationshipType ? `${friend.relationshipType} wanted to join` : undefined
      );
      setShowFriendsPanel(false);
    }
  }, []);

  const handlePersonalitySave = useCallback((updatedCompanion: Companion, traits: Record<string, number>) => {
    setCompanion(updatedCompanion);
    if (wsRef.current?.isConnected) {
      const traitSummary = Object.entries(traits)
        .map(([key, value]) => `${key}: ${value}%`)
        .join(', ');
      wsRef.current.sendMessage(
        `[System: My personality settings have been updated. New traits: ${traitSummary}. Please acknowledge this change and respond naturally with your updated personality.]`
      );
      setIsLoading(true);
    }
  }, []);

  const handleVideoRequestSuccess = useCallback((videoRequestId: string, newBalance: number) => {
    setTokenBalance(newBalance);
    toast.success('Video request submitted! Check your Media Gallery for updates.');
  }, []);

  // Handler for when a gift is sent - adds gift message to chat and triggers companion reaction
  const handleGiftSent = useCallback((gift: Gift) => {
    // Create gift message for display
    const giftMessage: Message = {
      id: `gift-${gift.id}`,
      role: 'user',
      content: `I'm giving you a ${gift.name}`,
      timestamp: new Date(),
      isNew: true,
      giftData: {
        id: gift.id,
        name: gift.name,
        description: gift.description,
        imageUrl: gift.imageUrl,
        emotionalMeaning: gift.emotionalMeaning,
        tokenCost: gift.tokenCost,
      },
    };

    // Add gift message to chat
    setMessages((prev) => [...prev, giftMessage]);

    // Send structured message for companion reaction
    if (wsRef.current?.isConnected) {
      const giftNotification = `[Gift: ${gift.name}] I'm giving you this ${gift.name}. ${gift.emotionalMeaning}`;
      wsRef.current.sendMessage(giftNotification);
      setIsLoading(true);
    }
  }, []);

  const handleAvatarLoad = useCallback((imageUrl: string, _cacheKey?: string, _turnId?: string) => {
    setCurrentAvatarUrl(imageUrl);
  }, []);

  return {
    // Auth state
    isAuthenticated,
    authLoading,
    user,

    // Messages
    messages,
    input,
    setInput,
    isLoading,
    streamingContent,
    showTypingBetweenMessages,
    handleSend,

    // Voice
    voiceModeEnabled,
    toggleVoiceMode,
    isRecording,
    voiceError,
    handleVoiceStart,
    handleVoiceEnd,
    liveTranscription,
    isTTSPlaying,

    // WebSocket
    wsConnected,
    wsRef,

    // Companion
    companion,
    setCompanion,
    backstoryData,
    isGeneratingNewCompanion,
    handleSwitchCompanion,
    currentEmotionalState,

    // Avatar/images
    currentAvatarUrl,
    setCurrentAvatarUrl,
    handleAvatarLoad,
    galleryImages,
    imageGenTrigger,
    sceneDescription,
    imageTurnId,
    customPrompt,
    avatarDimensions,
    mobileAvatarPop,

    // Mobile gallery
    mobileGalleryImages,
    mobileGalleryIndex,
    setMobileGalleryIndex,
    mobileGalleryLoading,

    // Likes
    messageLikes,
    sessionTotalLikes,
    likeAnimationTrigger,
    handleLikeMessage,

    // Group chat
    isGroupChat,
    groupParticipants,
    hostCompanionId,
    chatEvents,
    typingCompanionId,
    streamingByCompanion,

    // Games
    activeGame,
    waitingForCompanionMove,
    handleStartGame,
    handleUserMove,
    handleResign,

    // Webcam
    isWebcamEnabled,
    isCapturing,
    webcamError,
    latestFrame,
    toggleWebcam,

    // Voice chat
    voiceState,
    isCallActive,
    isCallMuted,
    agentMessage,
    userTranscript: voiceUserTranscript,
    voiceCallError,
    startVoiceChat,
    stopVoiceChat,
    toggleCallMute: () => setCallMuted(!isCallMuted),
    getInputFrequencyData,
    getOutputFrequencyData,
    handleCallClick,
    currentVideoUrl,
    isVideoLoading,
    videoEnabled,
    setVideoEnabled,

    // Video call
    videoCallStatus,
    isVideoCallActive,
    videoCallDuration,
    remoteVideoTrack,
    remoteAudioTrack,
    isVideoMicMuted,
    isVideoCameraEnabled,
    videoCallError,
    videoCallSummary,
    showVideoCall,
    handleVideoCallClick,
    handleVideoCallEnd,
    handleVideoCallClose,
    toggleVideoMic,
    toggleVideoCamera,

    // UI toggles
    showDebugPanel,
    setShowDebugPanel,
    showGallery,
    setShowGallery,
    showPersonality,
    setShowPersonality,
    showBackstory,
    setShowBackstory,
    showVideoRequest,
    setShowVideoRequest,
    tokenBalance,
    showGiftsPanel,
    setShowGiftsPanel,
    showFriendsPanel,
    setShowFriendsPanel,
    showMobileAvatar,
    setShowMobileAvatar,
    showMobileMenu,
    setShowMobileMenu,
    showGames,
    setShowGames,
    showSupportModal,
    setShowSupportModal,
    debugRefreshTrigger,

    // Sidebar resize
    sidebarWidth,
    sidebarRef,
    isResizing,
    isNearGrabber,
    handleResizeStart,
    handleMouseMoveNearGrabber,
    handleMouseLeaveGrabber,

    // Refs
    messagesEndRef,
    inputRef,
    inputContainerRef,
    keyboardHeight,
    inputHeight,
    hasShownPulse,
    messageReceivedPulseTrigger,
    scrollToBottom,

    // Demo
    isDemo,
    demoMessagesUsed,
    onRequireAuth,

    // Handlers for modals
    handleInviteFriend,
    handlePersonalitySave,
    handleVideoRequestSuccess,
    handleGiftSent,

    // Router
    router,
  };
}
