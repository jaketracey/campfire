'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { X, ArrowRight, Mic, MicOff, Bug, Images, Flame, Sparkles, Gift, BookOpen, GripVertical, Volume2, Menu, User, Video, VideoOff, Gamepad2, Heart, Users } from 'lucide-react';
import Link from 'next/link';
import { getSessionTurns, getSession, getCompanion, getCompanionBackstory, type Companion, type CompanionBackstory } from '@/lib/api';
import { CampfireWebSocket, connectWebSocket, type GroupParticipant } from '@/lib/ws';
import { ParticipantList, GroupMessageBubble, CompanionJoinNotification, TypingIndicator } from '@/components/group-chat';
import { CompanionAvatar, StaticCompanionAvatar, CompanionGallery, PersonalityModal, BackstoryModal } from '@/components/companion';
import { DebugPanel } from '@/components/debug-panel';
import { GiftsPanel } from '@/components/gifts';
import { FriendsPanel } from '@/components/friends';
import { GamesModal, GameBoardContainer } from '@/components/games';
import { LikeButton } from '@/components/likes';
import type { ActiveGame } from '@campfire/shared';
import { useRequireAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { buildPromptFromCompanion, getSessionGallery, type EmotionalState, type GalleryImage } from '@/lib/api/imagegen';
import { useVoiceRecording } from '@/hooks/use-voice-recording';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useWebcamCapture } from '@/hooks/use-webcam-capture';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  emotionalState?: EmotionalState;
  // Group chat fields
  companionId?: string;
  companionName?: string;
  themeColor?: string;
  isReaction?: boolean;
}

// Chat event for join/leave notifications
interface ChatEvent {
  id: string;
  type: 'companion_joined' | 'companion_left';
  companionId: string;
  companionName: string;
  avatarUrl: string | null;
  themeColor: string;
  reason?: string;
  invitedByName?: string;
  timestamp: Date;
}

interface ChatSessionContentProps {
  sessionId: string;
}

// Simple emotional state detection based on message content
function detectEmotionalState(content: string): EmotionalState {
  const lowerContent = content.toLowerCase();

  if (lowerContent.match(/\b(happy|great|wonderful|excited|amazing|love|joy)\b/)) {
    return 'happy';
  }
  if (lowerContent.match(/\b(curious|wonder|how|why|what|tell me|explain)\b/)) {
    return 'curious';
  }
  if (lowerContent.match(/\b(excited|can't wait|thrilling|awesome)\b/)) {
    return 'excited';
  }
  if (lowerContent.match(/\b(think|consider|perhaps|maybe|ponder)\b/)) {
    return 'thoughtful';
  }
  if (lowerContent.match(/\b(here for you|understand|feel|sorry|help)\b/)) {
    return 'supportive';
  }
  if (lowerContent.match(/\b(haha|lol|funny|joke|play|fun)\b/)) {
    return 'playful';
  }
  if (lowerContent.match(/\b(calm|peace|relax|breathe|gentle)\b/)) {
    return 'calm';
  }

  return 'neutral';
}

// Extract scene/action description from LLM response for image generation
function extractSceneDescription(content: string): string | undefined {
  // Look for action markers like *action* or (action)
  const actionMatch = content.match(/\*([^*]+)\*/);
  if (actionMatch) {
    return actionMatch[1];
  }

  // Look for parenthetical descriptions
  const parenMatch = content.match(/\(([^)]+)\)/);
  if (parenMatch) {
    return parenMatch[1];
  }

  // Take the first sentence and extract key visual elements
  const firstSentence = content.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length < 100) {
    // Look for visual/action verbs
    const visualMatch = firstSentence.match(/\b(smil|laugh|grin|look|gaz|lean|sit|stand|walk|danc|hug|wav|wink|blush|sigh)\w*/i);
    if (visualMatch) {
      return firstSentence.trim();
    }
  }

  return undefined;
}

export function ChatSessionContent({ sessionId }: ChatSessionContentProps) {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useRequireAuth('/login');
  const user = useAuthStore((state) => state.user);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [currentEmotionalState, setCurrentEmotionalState] = useState<EmotionalState>('neutral');
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showPersonality, setShowPersonality] = useState(false);
  const [showBackstory, setShowBackstory] = useState(false);
  const [showGiftsPanel, setShowGiftsPanel] = useState(false);
  const [showFriendsPanel, setShowFriendsPanel] = useState(false);
  const [showMobileAvatar, setShowMobileAvatar] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showGames, setShowGames] = useState(false);
  const [activeGame, setActiveGame] = useState<ActiveGame | null>(null);
  const [waitingForCompanionMove, setWaitingForCompanionMove] = useState(false);
  const [debugRefreshTrigger, setDebugRefreshTrigger] = useState(0);
  const [companion, setCompanion] = useState<Companion | null>(null);
  const [backstoryData, setBackstoryData] = useState<CompanionBackstory | null>(null);
  // Track image generation - only generate after LLM response
  const [imageGenTrigger, setImageGenTrigger] = useState(0);
  // Dynamic avatar URL - synced with generated images
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null);
  // Gallery images for random display on load
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [sceneDescription, setSceneDescription] = useState<string | undefined>(undefined);
  // Likes tracking
  const [messageLikes, setMessageLikes] = useState<Record<string, number>>({});
  const [sessionTotalLikes, setSessionTotalLikes] = useState(0);
  // Multi-message sequence tracking
  const [showTypingBetweenMessages, setShowTypingBetweenMessages] = useState(false);
  // Group chat state
  const [isGroupChat, setIsGroupChat] = useState(false);
  const [groupParticipants, setGroupParticipants] = useState<GroupParticipant[]>([]);
  const [hostCompanionId, setHostCompanionId] = useState<string | null>(null);
  const [chatEvents, setChatEvents] = useState<ChatEvent[]>([]);
  const [typingCompanionId, setTypingCompanionId] = useState<string | null>(null);
  const [streamingByCompanion, setStreamingByCompanion] = useState<Map<string, string>>(new Map());
  // Resizable sidebar state
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const [isNearGrabber, setIsNearGrabber] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<CampfireWebSocket | null>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // Track if we've shown the initial pulse animation (only show once)
  const [hasShownPulse, setHasShownPulse] = useState(false);

  // Handle iOS keyboard - position input above keyboard
  useEffect(() => {
    let rafId: number;

    const updateLayout = () => {
      if (rafId) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        const vv = window.visualViewport;
        if (!vv) return;

        // Calculate keyboard height: difference between window height and visual viewport
        const kbHeight = window.innerHeight - vv.height;
        setKeyboardHeight(kbHeight);

        // Position input container fixed above keyboard
        if (inputContainerRef.current) {
          if (kbHeight > 0) {
            // Keyboard is open - fix input above it
            inputContainerRef.current.style.position = 'fixed';
            inputContainerRef.current.style.bottom = `${kbHeight}px`;
            inputContainerRef.current.style.left = '0';
            inputContainerRef.current.style.right = '0';
          } else {
            // Keyboard closed - reset to normal flow
            inputContainerRef.current.style.position = '';
            inputContainerRef.current.style.bottom = '';
            inputContainerRef.current.style.left = '';
            inputContainerRef.current.style.right = '';
          }
        }
      });
    };

    // Continuous update during keyboard animation
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

    // Initial
    updateLayout();

    // Visual viewport events
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateLayout);
      window.visualViewport.addEventListener('scroll', updateLayout);
    }

    // Focus triggers keyboard
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

  // Webcam capture hook for sending frames to AI
  const {
    isEnabled: isWebcamEnabled,
    isCapturing,
    error: webcamError,
    latestFrame,
    enableWebcam,
    disableWebcam,
  } = useWebcamCapture(wsRef, {
    captureInterval: 10000, // 10 seconds
    targetWidth: 640,
    targetHeight: 480,
    quality: 0.75,
  });

  // Toggle webcam mode
  const toggleWebcam = useCallback(async () => {
    if (isWebcamEnabled) {
      disableWebcam();
    } else {
      await enableWebcam();
    }
  }, [isWebcamEnabled, enableWebcam, disableWebcam]);

  // Refs to store stable references to audio functions for WebSocket callbacks
  const queueAudioRef = useRef(queueAudio);
  const finishQueueRef = useRef(finishQueue);
  useEffect(() => {
    queueAudioRef.current = queueAudio;
    finishQueueRef.current = finishQueue;
  }, [queueAudio, finishQueue]);

  // Calculate avatar dimensions based on sidebar width
  // Maintain a portrait aspect ratio (roughly 5:8) with some padding
  // Generation dimensions are always at least 512x768 for quality
  const avatarDimensions = useMemo(() => {
    const padding = 32; // 16px on each side
    const availableWidth = sidebarWidth - padding;
    const displayWidth = Math.max(150, availableWidth);
    const displayHeight = Math.round(displayWidth * 1.6); // 5:8 aspect ratio
    // Generate at higher resolution for quality (minimum 512x768)
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent]);

  // Load session, companion, and existing turns from API - wait for auth to be ready
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    async function loadSessionData() {
      try {
        // Load session to get companion ID
        const session = await getSession(sessionId);
        console.log('[ChatSession] Session loaded:', { sessionId: session.id, companionId: session.companionId });

        // Load companion with full spec (including visual data)
        if (session.companionId) {
          try {
            const companionData = await getCompanion(session.companionId);
            console.log('[ChatSession] Companion loaded:', { companionId: companionData.id, name: companionData.name });
            setCompanion(companionData);

            // Also fetch backstory from knowledge graph
            try {
              const backstory = await getCompanionBackstory(session.companionId);
              setBackstoryData(backstory);
            } catch (err) {
              console.warn('Failed to load backstory:', err);
            }
          } catch (err) {
            console.warn('Failed to load companion:', err);
          }
        }

        // Load conversation history
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
  }, [sessionId, authLoading, isAuthenticated]);

  // Fetch gallery images on load and pick a random one for display
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    async function loadGallery() {
      try {
        const gallery = await getSessionGallery(sessionId, 20);
        if (gallery.images && gallery.images.length > 0) {
          setGalleryImages(gallery.images);
          // Pick a random image for initial display
          const randomIndex = Math.floor(Math.random() * gallery.images.length);
          setCurrentAvatarUrl(gallery.images[randomIndex].s3_url);
        }
      } catch (err) {
        console.warn('[Chat] Failed to load gallery:', err);
      }
    }

    loadGallery();
  }, [sessionId, authLoading, isAuthenticated]);

  // Fallback to companion avatar if no gallery images
  useEffect(() => {
    if (!currentAvatarUrl && companion?.avatarUrl) {
      setCurrentAvatarUrl(companion.avatarUrl);
    }
  }, [companion?.avatarUrl, currentAvatarUrl]);

  // Connect to WebSocket - wait for auth to be ready
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    const accessToken = useAuthStore.getState().accessToken;
    if (!accessToken) {
      console.error('[Chat] No access token available for WebSocket auth');
      return;
    }

    const ws = connectWebSocket();
    wsRef.current = ws;

    // Subscribe to ping (connection established) - then authenticate
    const unsubPing = ws.on('ping', () => {
      console.log('[Chat] WebSocket connected, authenticating...');
      ws.authenticate(accessToken);
    });

    // Subscribe to auth success - then resume session
    const unsubAuth = ws.on('auth_success', () => {
      console.log('[Chat] Authenticated via WebSocket, resuming session...');
      ws.resumeSession(sessionId);
    });

    // Subscribe to session started
    const unsubSessionStarted = ws.on<{
      sessionId: string;
      companionId: string;
      isGroupChat?: boolean;
      participants?: GroupParticipant[];
    }>('session_started', (msg) => {
      setWsConnected(true);
      console.log('[Chat] Session resumed via WebSocket');

      // Initialize group chat state if applicable
      if (msg.payload.isGroupChat !== undefined) {
        setIsGroupChat(msg.payload.isGroupChat);
      }
      if (msg.payload.participants) {
        setGroupParticipants(msg.payload.participants);
        setHostCompanionId(msg.payload.companionId);
      }
    });

    // Subscribe to agent messages (non-streaming)
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
        },
      ]);
      // Extract scene description and trigger image generation
      const scene = extractSceneDescription(content);
      setSceneDescription(scene);
      setImageGenTrigger((prev) => prev + 1);
      // Trigger debug panel refresh
      setDebugRefreshTrigger((prev) => prev + 1);
    });

    // Subscribe to streaming chunks
    const unsubChunk = ws.onAgentChunk((chunk) => {
      setStreamingContent((prev) => prev + chunk);
    });

    // Subscribe to message end (with multi-message sequence support)
    const unsubEnd = ws.onAgentMessageEnd((content, imagePrompt, sequence) => {
      const emotionalState = detectEmotionalState(content);

      // Add message immediately
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content,
          timestamp: new Date(),
          emotionalState,
        },
      ]);

      // Clear streaming content for this message
      setStreamingContent('');

      // Handle multi-message sequences
      if (sequence && !sequence.isLast) {
        // More messages coming - show typing indicator between messages
        setShowTypingBetweenMessages(true);
        // Keep loading state since more messages are coming
        return;
      }

      // This is the last message (or single message) - finalize
      setShowTypingBetweenMessages(false);
      setIsLoading(false);
      setCurrentEmotionalState(emotionalState);

      // Use companion's imagePrompt directly, fallback to scene extraction for older messages
      const scene = imagePrompt || extractSceneDescription(content);
      setSceneDescription(scene);
      setImageGenTrigger((prev) => prev + 1);
      // Trigger debug panel refresh
      setDebugRefreshTrigger((prev) => prev + 1);
    });

    // Subscribe to errors
    const unsubError = ws.onError((message) => {
      console.error('[Chat] WebSocket error:', message);
      setIsLoading(false);
    });

    // Subscribe to voice transcription
    const unsubTranscription = ws.onVoiceTranscription((text, isFinal) => {
      if (isFinal) {
        setLiveTranscription('');
      } else {
        setLiveTranscription(text);
      }
    });

    // Subscribe to TTS audio chunks
    const unsubTTSChunk = ws.onTTSChunk((data) => {
      queueAudioRef.current(data, 'mp3');
    });

    // Subscribe to TTS end
    const unsubTTSEnd = ws.onTTSEnd(() => {
      finishQueueRef.current();
    });

    // Subscribe to game updates
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

    // Subscribe to like acknowledgments
    const unsubLikeAck = ws.onLikeAcknowledged(({ turnId, turnLikes, sessionLikes }) => {
      setMessageLikes((prev) => ({ ...prev, [turnId]: turnLikes }));
      setSessionTotalLikes(sessionLikes);
    });

    // Group chat: Subscribe to companion joined
    const unsubCompanionJoined = ws.onCompanionJoined(({ companion, invitedByCompanionId, reason, participants }) => {
      setGroupParticipants(participants);
      setIsGroupChat(participants.length > 1);

      // Find who invited
      const invitedBy = participants.find(p => p.companionId === invitedByCompanionId);

      // Add join event to chat
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

    // Group chat: Subscribe to companion left
    const unsubCompanionLeft = ws.onCompanionLeft(({ companionId, companionName, reason, participants }) => {
      setGroupParticipants(participants);
      setIsGroupChat(participants.length > 1);

      // Get theme color before removing
      const leftCompanion = groupParticipants.find(p => p.companionId === companionId);

      // Add leave event to chat
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

    // Group chat: Subscribe to group chat state updates
    const unsubGroupChatState = ws.onGroupChatState((state) => {
      setIsGroupChat(state.isGroupChat);
      setGroupParticipants(state.participants);
      setHostCompanionId(state.hostCompanionId);
    });

    // Group chat: Subscribe to companion message start (typing)
    const unsubCompanionMsgStart = ws.onCompanionMessageStart(({ companionId }) => {
      setTypingCompanionId(companionId);
      setStreamingByCompanion((prev) => {
        const next = new Map(prev);
        next.set(companionId, '');
        return next;
      });
    });

    // Group chat: Subscribe to companion message chunks
    const unsubCompanionChunk = ws.onCompanionMessageChunk((companionId, content) => {
      setStreamingByCompanion((prev) => {
        const next = new Map(prev);
        next.set(companionId, (prev.get(companionId) || '') + content);
        return next;
      });
    });

    // Group chat: Subscribe to companion message end
    const unsubCompanionMsgEnd = ws.onCompanionMessageEnd(({ companionId, companionName, content, isReaction, turnId }) => {
      setTypingCompanionId(null);
      setStreamingByCompanion((prev) => {
        const next = new Map(prev);
        next.delete(companionId);
        return next;
      });

      // Get companion theme color
      const companion = groupParticipants.find(p => p.companionId === companionId);
      const emotionalState = detectEmotionalState(content);

      setMessages((prev) => [
        ...prev,
        {
          id: turnId || crypto.randomUUID(),
          role: 'assistant',
          content,
          timestamp: new Date(),
          emotionalState,
          companionId,
          companionName,
          themeColor: companion?.themeColor || '#8B5CF6',
          isReaction,
        },
      ]);

      // Update emotional state if this is the primary companion
      if (!isReaction && companionId === hostCompanionId) {
        setCurrentEmotionalState(emotionalState);
      }

      setIsLoading(false);
    });

    // Note: connectWebSocket() already calls connect(), don't call it again

    return () => {
      unsubPing();
      unsubAuth();
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
  }, [sessionId, authLoading, isAuthenticated]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setStreamingContent('');

    // Send via WebSocket
    if (wsRef.current?.isConnected) {
      wsRef.current.sendMessage(input.trim());
    } else {
      console.error('WebSocket not connected');
      setIsLoading(false);
    }

    // Refocus the input for continued typing (setTimeout needed for iOS)
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  }, [input, isLoading]);

  // Handle liking a message
  const handleLikeMessage = useCallback((turnId: string) => {
    if (!wsRef.current?.isConnected) return;
    wsRef.current.likeMessage(turnId);
  }, []);

  // Handle starting a game from the modal
  const handleStartGame = useCallback((gameType: string) => {
    if (!wsRef.current?.isConnected) return;

    // Send a message asking to start the game - the companion will use the game_start tool
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

  // Handle user making a move in the game
  const handleUserMove = useCallback((move: string) => {
    if (!wsRef.current?.isConnected || !activeGame) return;

    // Update local game state optimistically
    if (activeGame.currentPlayer === 'user') {
      const newMoveHistory = [...activeGame.moveHistory, {
        player: 'user' as const,
        notation: move,
        timestamp: new Date().toISOString(),
      }];

      // For tic-tac-toe, update the board
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

    // Send the move as a message
    const message = `[Game move: ${move}]`;
    wsRef.current.sendMessage(message);
    setIsLoading(true);
  }, [activeGame]);

  // Handle resigning from the game
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

    // Clear game state
    setActiveGame(null);
    setWaitingForCompanionMove(false);
  }, [activeGame]);

  // Toggle voice mode on/off
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

  // Handle push-to-talk start
  const handleVoiceStart = useCallback(() => {
    if (!voiceModeEnabled || isLoading) return;
    startRecording();
  }, [voiceModeEnabled, isLoading, startRecording]);

  // Handle push-to-talk end
  const handleVoiceEnd = useCallback(() => {
    if (!isRecording) return;
    stopRecording();
    setIsLoading(true);
  }, [isRecording, stopRecording]);

  // Handle resize start
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  // Handle resize move
  // Auto-focus input when page loads and WebSocket connects
  useEffect(() => {
    if (wsConnected && inputRef.current) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [wsConnected]);

  // Mark pulse as shown once user starts typing
  useEffect(() => {
    if (input.length > 0 && !hasShownPulse) {
      setHasShownPulse(true);
    }
  }, [input, hasShownPulse]);

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

  // Detect when mouse is near the grabber zone
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

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Companion Avatar Sidebar */}
      <div
        ref={sidebarRef}
        className="hidden lg:flex flex-col items-center p-4 bg-muted/10 relative select-none"
        style={{ width: sidebarWidth }}
        onMouseMove={handleMouseMoveNearGrabber}
        onMouseLeave={handleMouseLeaveGrabber}
      >
        {/* Only render CompanionAvatar once we have companion data with anchor image */}
        {companion?.avatarUrl ? (
          <button
            onClick={() => setShowGallery(true)}
            className="cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-campfire-500 focus:ring-offset-2 focus:ring-offset-background rounded-xl overflow-hidden"
            style={{ width: avatarDimensions.width, height: avatarDimensions.height }}
            aria-label="View gallery"
          >
            <CompanionAvatar
              emotionalState={currentEmotionalState}
              style="stylized"
              customPrompt={customPrompt}
              width={avatarDimensions.genWidth}
              height={avatarDimensions.genHeight}
              autoRegenerate={false}
              debounceDelay={2000}
              className="shadow-lg w-full h-full"
              userId={user?.id}
              sessionId={sessionId}
              companionId={companion.id}
              anchorImageUrl={companion.avatarUrl}
              generationTrigger={imageGenTrigger}
              sceneDescription={sceneDescription}
              onLoad={(imageUrl) => {
                // Sync mobile avatar with newly generated image
                setCurrentAvatarUrl(imageUrl);
              }}
            />
          </button>
        ) : (
          /* Loading placeholder while companion data loads */
          <div
            className="rounded-xl bg-gradient-to-b from-primary/5 to-primary/10 shadow-lg animate-pulse"
            style={{ width: avatarDimensions.width, height: avatarDimensions.height }}
          />
        )}
        {companion && (
          <p className="mt-3 text-base font-semibold text-foreground">{companion.name}</p>
        )}
        {sessionTotalLikes > 0 && (
          <div className="flex items-center justify-center gap-1 mt-1 text-sm text-muted-foreground">
            <Heart className="h-3.5 w-3.5 text-red-500 fill-red-500" />
            <span className="font-medium text-foreground">{sessionTotalLikes}</span>
          </div>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          Feeling: <span className="font-medium text-foreground capitalize">{currentEmotionalState}</span>
        </p>
        <div className="flex flex-col gap-2.5 mt-4 w-full px-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 px-5 py-4 text-base"
            onClick={() => setShowPersonality(true)}
          >
            <Sparkles className="h-5 w-5" />
            Personality
          </Button>
          {backstoryData?.hasBackstory && (
            <Button
              variant="outline"
              className="w-full justify-start gap-3 px-5 py-4 text-base border-amber-700/30 text-amber-500 hover:bg-amber-900/20 hover:text-amber-400"
              onClick={() => setShowBackstory(true)}
            >
              <BookOpen className="h-5 w-5" />
              Backstory
            </Button>
          )}
          <Button
            variant="outline"
            className="w-full justify-start gap-3 px-5 py-4 text-base border-emerald-700/30 text-emerald-500 hover:bg-emerald-900/20 hover:text-emerald-400"
            onClick={() => setShowGames(true)}
          >
            <Gamepad2 className="h-5 w-5" />
            Games
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3 px-5 py-4 text-base border-rose-700/30 text-rose-500 hover:bg-rose-900/20 hover:text-rose-400"
            onClick={() => setShowGiftsPanel(true)}
          >
            <Gift className="h-5 w-5" />
            Gifts
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3 px-5 py-4 text-base border-purple-700/30 text-purple-500 hover:bg-purple-900/20 hover:text-purple-400"
            onClick={() => setShowFriendsPanel(true)}
          >
            <Users className="h-5 w-5" />
            Friends
          </Button>
        </div>

        {/* Spacer to push webcam to bottom */}
        <div className="flex-1" />

        {/* Webcam preview at bottom of sidebar */}
        {isWebcamEnabled && latestFrame && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <div className="relative">
              <img
                src={latestFrame}
                alt="Webcam preview"
                className="w-24 h-18 rounded-lg object-cover border-2 border-campfire-500/50 shadow-md"
              />
              {isCapturing && (
                <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse shadow-sm" />
              )}
            </div>
            <span className="text-xs text-muted-foreground">Camera active</span>
          </div>
        )}

        {/* Resize Grabber */}
        <AnimatePresence>
          {(isNearGrabber || isResizing) && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="absolute right-0 top-0 bottom-0 w-4 flex items-center justify-center cursor-col-resize z-10"
              onMouseDown={handleResizeStart}
            >
              <motion.div
                className="h-16 w-1.5 rounded-full bg-muted-foreground/30 flex items-center justify-center"
                whileHover={{ scale: 1.2, backgroundColor: 'rgba(255,255,255,0.4)' }}
                whileTap={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.5)' }}
                animate={isResizing ? { scale: 1.1, backgroundColor: 'rgba(255,255,255,0.5)' } : {}}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground/50" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Main Chat Area */}
      <div className="flex flex-col flex-1">
        {/* Header - fixed transparent on mobile */}
        <header className="px-4 py-3 flex items-center gap-4 lg:relative fixed top-0 left-0 right-0 z-50 lg:bg-transparent bg-transparent lg:backdrop-blur-none backdrop-blur-sm">
          <Link href="/chat" className="flex items-center gap-2">
            <Flame className="h-7 w-7 text-campfire-500" />
            <span className="text-lg font-bold">Campfire</span>
          </Link>
          <div className="flex-1" />

          {/* Desktop buttons */}
          <div className="hidden lg:flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowGallery(true)}
              title="View Gallery"
            >
              <Images className="h-4 w-4" />
            </Button>
            <Button
              variant={showGiftsPanel ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setShowGiftsPanel(!showGiftsPanel)}
              title="Send Gifts"
            >
              <Gift className="h-4 w-4" />
            </Button>
            <Button
              variant={showDebugPanel ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setShowDebugPanel(!showDebugPanel)}
              title="Toggle Debug Panel"
            >
              <Bug className="h-4 w-4" />
            </Button>
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" title="Close">
                <X className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          {/* Mobile hamburger menu */}
          <div className="lg:hidden relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              title="Menu"
            >
              <Menu className="h-5 w-5" />
            </Button>

            {/* Mobile dropdown menu */}
            <AnimatePresence>
              {showMobileMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 bg-background/95 backdrop-blur-md border rounded-lg shadow-lg p-2 min-w-[160px]"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2"
                    onClick={() => {
                      setShowGallery(true);
                      setShowMobileMenu(false);
                    }}
                  >
                    <Images className="h-4 w-4" />
                    Gallery
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2"
                    onClick={() => {
                      setShowGiftsPanel(!showGiftsPanel);
                      setShowMobileMenu(false);
                    }}
                  >
                    <Gift className="h-4 w-4" />
                    Gifts
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2"
                    onClick={() => {
                      setShowDebugPanel(!showDebugPanel);
                      setShowMobileMenu(false);
                    }}
                  >
                    <Bug className="h-4 w-4" />
                    Debug
                  </Button>
                  <Link href="/account" className="block">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2"
                      onClick={() => setShowMobileMenu(false)}
                    >
                      <User className="h-4 w-4" />
                      Account
                    </Button>
                  </Link>
                  <Link href="/dashboard" className="block">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2"
                      onClick={() => setShowMobileMenu(false)}
                    >
                      <X className="h-4 w-4" />
                      Close
                    </Button>
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        {/* Spacer for fixed header on mobile */}
        <div className="h-14 lg:hidden" />

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-4"
          style={{ paddingBottom: keyboardHeight > 0 ? `${keyboardHeight + 80}px` : undefined }}
        >
          {messages.length === 0 && !streamingContent && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Start a conversation with your companion
            </div>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <Card
                className={`max-w-[80%] p-3 ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                {message.role === 'assistant' && (
                  <div className="flex justify-end mt-1 -mb-1 -mr-1">
                    <LikeButton
                      turnId={message.id}
                      initialCount={messageLikes[message.id] || 0}
                      onLike={handleLikeMessage}
                    />
                  </div>
                )}
              </Card>
            </div>
          ))}
          {/* Streaming message */}
          {streamingContent && (
            <div className="flex justify-start">
              <Card className="bg-muted p-3 max-w-[80%]">
                <p className="text-sm whitespace-pre-wrap">{streamingContent}</p>
              </Card>
            </div>
          )}
          {/* Loading indicator / typing indicator between multi-messages */}
          {(isLoading && !streamingContent) || showTypingBetweenMessages ? (
            <motion.div
              className="flex justify-start"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Card className={`bg-muted p-3 ${showTypingBetweenMessages ? 'mt-1' : ''}`}>
                <div className="flex gap-1">
                  <motion.span
                    className="w-2 h-2 bg-foreground/50 rounded-full"
                    animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                  />
                  <motion.span
                    className="w-2 h-2 bg-foreground/50 rounded-full"
                    animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: 0.1 }}
                  />
                  <motion.span
                    className="w-2 h-2 bg-foreground/50 rounded-full"
                    animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
                  />
                </div>
              </Card>
            </motion.div>
          ) : null}
          {/* Active Game Board */}
          {activeGame && (
            <div className="flex justify-center my-4">
              <GameBoardContainer
                gameState={activeGame}
                onUserMove={handleUserMove}
                onResign={handleResign}
                companionName={companion?.name || 'Companion'}
                isWaitingForCompanion={waitingForCompanionMove}
              />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div ref={inputContainerRef} className="p-4 bg-background z-40">
          {/* Live transcription display */}
          {liveTranscription && (
            <div className="max-w-4xl mx-auto mb-2">
              <Card className="p-2 bg-muted/50 border-dashed">
                <p className="text-sm text-muted-foreground italic">{liveTranscription}</p>
              </Card>
            </div>
          )}

          {/* Voice error display */}
          {voiceError && (
            <div className="max-w-4xl mx-auto mb-2">
              <Card className="p-2 bg-destructive/10 border-destructive/50">
                <p className="text-sm text-destructive">{voiceError}</p>
              </Card>
            </div>
          )}

          {/* Webcam error display */}
          {webcamError && (
            <div className="max-w-4xl mx-auto mb-2">
              <Card className="p-2 bg-destructive/10 border-destructive/50">
                <p className="text-sm text-destructive">{webcamError}</p>
              </Card>
            </div>
          )}

          <div className="flex gap-2 max-w-4xl mx-auto">
            {/* Voice mode toggle */}
            <Button
              variant={voiceModeEnabled ? 'secondary' : 'outline'}
              size="icon"
              onClick={toggleVoiceMode}
              title={voiceModeEnabled ? 'Disable voice mode' : 'Enable voice mode'}
            >
              <Volume2 className={`h-5 w-5 ${voiceModeEnabled ? 'text-campfire-500' : ''}`} />
            </Button>

            {/* Webcam toggle */}
            <Button
              variant={isWebcamEnabled ? 'secondary' : 'outline'}
              size="icon"
              onClick={toggleWebcam}
              title={isWebcamEnabled ? 'Disable webcam' : 'Enable webcam'}
              className={isCapturing ? 'animate-pulse' : ''}
            >
              {isWebcamEnabled ? (
                <Video className="h-5 w-5 text-campfire-500" />
              ) : (
                <VideoOff className="h-5 w-5" />
              )}
            </Button>

            {/* Push-to-talk mic button */}
            {voiceModeEnabled && (
              <Button
                variant={isRecording ? 'destructive' : 'outline'}
                size="icon"
                onMouseDown={handleVoiceStart}
                onMouseUp={handleVoiceEnd}
                onMouseLeave={handleVoiceEnd}
                onTouchStart={handleVoiceStart}
                onTouchEnd={handleVoiceEnd}
                disabled={isLoading || isTTSPlaying}
                title={isRecording ? 'Release to send' : 'Hold to speak'}
                className={isRecording ? 'animate-pulse' : ''}
              >
                {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </Button>
            )}

            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
              placeholder={voiceModeEnabled ? 'Type or hold mic to speak...' : 'Type a message...'}
              readOnly={isLoading || isRecording}
              className={`flex-1 transition-shadow duration-300 ${
                !hasShownPulse && input.length === 0
                  ? 'focus:animate-campfire-pulse'
                  : ''
              }`}
            />
            <Button
              onClick={handleSend}
              onMouseDown={(e) => e.preventDefault()}
              disabled={!input.trim() || isLoading || isRecording}
            >
              <ArrowRight className="h-5 w-5" />
            </Button>
          </div>

          {/* TTS playback indicator */}
          {isTTSPlaying && (
            <div className="max-w-4xl mx-auto mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="flex gap-1 items-end h-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-campfire-500 rounded-full"
                    animate={{
                      height: [4, 16, 8, 12, 4],
                    }}
                    transition={{
                      duration: 0.6,
                      repeat: Infinity,
                      delay: i * 0.1,
                      ease: 'easeInOut',
                    }}
                  />
                ))}
              </div>
              <span>Speaking...</span>
            </div>
          )}

        </div>

        {/* Mobile/Tablet Floating Avatar Thumbnail */}
        {currentAvatarUrl && (
          <button
            onClick={() => setShowMobileAvatar(true)}
            className="lg:hidden fixed bottom-24 right-4 z-40 w-20 h-24 rounded-xl overflow-hidden border-2 border-campfire-500 shadow-lg bg-muted/80 backdrop-blur-sm hover:scale-105 transition-transform"
            aria-label="View companion"
          >
            <StaticCompanionAvatar
              imageUrl={currentAvatarUrl}
              width={80}
              height={96}
              className="w-full h-full"
            />
          </button>
        )}
      </div>

      {/* Debug Panel */}
      <DebugPanel
        sessionId={sessionId}
        isOpen={showDebugPanel}
        onClose={() => setShowDebugPanel(false)}
        refreshTrigger={debugRefreshTrigger}
      />

      {/* Companion Gallery */}
      <CompanionGallery
        sessionId={sessionId}
        isOpen={showGallery}
        onClose={() => setShowGallery(false)}
      />

      {/* Personality Modal */}
      <PersonalityModal
        companion={companion}
        isOpen={showPersonality}
        onClose={() => setShowPersonality(false)}
        onSave={(updatedCompanion, traits) => {
          setCompanion(updatedCompanion);
          // Send a message to notify the model of personality changes
          if (wsRef.current?.isConnected) {
            const traitSummary = Object.entries(traits)
              .map(([key, value]) => `${key}: ${value}%`)
              .join(', ');
            wsRef.current.sendMessage(
              `[System: My personality settings have been updated. New traits: ${traitSummary}. Please acknowledge this change and respond naturally with your updated personality.]`
            );
            setIsLoading(true);
          }
        }}
      />

      {/* Backstory Modal - Oblivion style reveal */}
      <BackstoryModal
        isOpen={showBackstory}
        onClose={() => setShowBackstory(false)}
        companionName={companion?.name || ''}
        backstory={backstoryData?.backstory || ''}
        archetype={companion?.spec?.personality?.archetype}
        avatarUrl={companion?.avatarUrl || undefined}
      />

      {/* Games Modal */}
      <GamesModal
        isOpen={showGames}
        onClose={() => setShowGames(false)}
        onSelectGame={handleStartGame}
        companionName={companion?.name}
      />

      {/* Gifts Panel */}
      {companion && (
        <GiftsPanel
          sessionId={sessionId}
          companionId={companion.id}
          isOpen={showGiftsPanel}
          onClose={() => setShowGiftsPanel(false)}
          onGiftSent={(gift) => {
            // Could trigger animation or chat notification
            console.log('Gift sent:', gift.name);
          }}
        />
      )}

      {/* Friends Panel */}
      {companion && (
        <FriendsPanel
          companionId={companion.id}
          companionName={companion.name}
          isOpen={showFriendsPanel}
          onClose={() => setShowFriendsPanel(false)}
          activeParticipantIds={groupParticipants.map(p => p.companionId)}
          isGroupChat={isGroupChat}
          onInviteFriend={(friend) => {
            if (wsRef.current?.isConnected) {
              wsRef.current.inviteCompanion(
                friend.friendCompanionId,
                friend.relationshipType ? `${friend.relationshipType} wanted to join` : undefined
              );
              // Close the panel after inviting
              setShowFriendsPanel(false);
            }
          }}
        />
      )}

      {/* Mobile Avatar Enlarged Modal */}
      {showMobileAvatar && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowMobileAvatar(false)}
        >
          <div
            className="relative flex flex-col items-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowMobileAvatar(false)}
              className="absolute top-2 right-2 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            {currentAvatarUrl && (
              <StaticCompanionAvatar
                imageUrl={currentAvatarUrl}
                width={280}
                height={420}
                className="shadow-2xl"
              />
            )}
            <p className="mt-3 text-sm text-white/80">
              {companion?.name}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                variant="secondary"
                size="sm"
                className="gap-1"
                onClick={() => {
                  setShowMobileAvatar(false);
                  setShowGallery(true);
                }}
              >
                <Images className="h-4 w-4" />
                Gallery
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="gap-1"
                onClick={() => {
                  setShowMobileAvatar(false);
                  setShowPersonality(true);
                }}
              >
                <Sparkles className="h-4 w-4" />
                Personality
              </Button>
              {backstoryData?.hasBackstory && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1 bg-amber-900/30 hover:bg-amber-900/50 text-amber-400 border-amber-700/30"
                  onClick={() => {
                    setShowMobileAvatar(false);
                    setShowBackstory(true);
                  }}
                >
                  <BookOpen className="h-4 w-4" />
                  Backstory
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
