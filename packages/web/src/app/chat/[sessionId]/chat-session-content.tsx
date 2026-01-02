'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { X, ArrowRight, Mic, MicOff, Bug, Images, Flame, Sparkles, Gift, BookOpen, GripVertical, Volume2, User, Video, VideoOff, Gamepad2, Heart, Users, ChevronLeft, ChevronRight, Phone, HelpCircle } from 'lucide-react';
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
import { LikeHeartsAnimation } from '@/components/likes/like-hearts-animation';
import { SupportModal } from '@/components/support/support-modal';
import type { ActiveGame } from '@campfire/shared';
import type { SignupTrigger } from '@/components/demo/signup-modal';
import { useRequireAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { buildPromptFromCompanion, getSessionGallery, type EmotionalState, type GalleryImage } from '@/lib/api/imagegen';
import { useVoiceRecording } from '@/hooks/use-voice-recording';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useWebcamCapture } from '@/hooks/use-webcam-capture';
import { useVoiceCall } from '@/hooks/use-voice-call';
import { CallButton, CallSidebar, InsufficientTokensModal } from '@/components/voice-call';
import { VideoRequestButton, VideoRequestModal } from '@/components/video';
import { getTokenBalance } from '@/lib/api/tokens';
import { toast } from 'sonner';

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
  // Animation control
  isNew?: boolean;
}

// Segment type for parsed message content
interface MessageSegment {
  type: 'action' | 'dialogue';
  content: string;
}

// Parse message content into action and dialogue segments
function parseMessageSegments(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const regex = /\*([^*]+)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add dialogue before the action (if any)
    if (match.index > lastIndex) {
      const dialogue = content.slice(lastIndex, match.index).trim();
      if (dialogue) {
        segments.push({ type: 'dialogue', content: dialogue });
      }
    }
    // Add the action
    segments.push({ type: 'action', content: match[1].trim() });
    lastIndex = regex.lastIndex;
  }

  // Add remaining dialogue after the last action
  if (lastIndex < content.length) {
    const dialogue = content.slice(lastIndex).trim();
    if (dialogue) {
      segments.push({ type: 'dialogue', content: dialogue });
    }
  }

  // If no segments found, return the whole content as dialogue
  if (segments.length === 0) {
    segments.push({ type: 'dialogue', content: content.trim() });
  }

  return segments;
}

// Animated message segments component
function AnimatedMessageSegments({
  segments,
  isUser,
  messageId,
  showLikeButton,
  likeCount,
  onLike,
  isNewMessage = false,
  onSegmentReveal,
}: {
  segments: MessageSegment[];
  isUser: boolean;
  messageId: string;
  showLikeButton?: boolean;
  likeCount?: number;
  onLike?: (id: string) => void;
  isNewMessage?: boolean;
  onSegmentReveal?: () => void;
}) {
  // Track how many action segments are visible (only actions stagger, only for new messages)
  const actionSegments = segments.filter((s) => s.type === 'action');
  const [visibleActionCount, setVisibleActionCount] = useState(isNewMessage ? 1 : actionSegments.length);

  // Progressively reveal action segments (only for new messages)
  useEffect(() => {
    if (!isNewMessage || visibleActionCount >= actionSegments.length) return;

    const timer = setTimeout(() => {
      setVisibleActionCount((prev) => prev + 1);
      onSegmentReveal?.();
    }, 1500);

    return () => clearTimeout(timer);
  }, [visibleActionCount, actionSegments.length, isNewMessage, onSegmentReveal]);

  // Find the last dialogue segment for the like button
  const lastDialogueIndex = segments.reduceRight(
    (acc, seg, idx) => (acc === -1 && seg.type === 'dialogue' ? idx : acc),
    -1
  );

  // Show segments progressively for new messages
  // Reveal action + everything after it until the next action
  let visibleSegments: MessageSegment[];

  if (!isNewMessage) {
    // Historical messages: show everything
    visibleSegments = segments;
  } else {
    // Find the index of the next unrevealed action
    let actionCount = 0;
    let cutoffIdx = segments.length;

    for (let i = 0; i < segments.length; i++) {
      if (segments[i].type === 'action') {
        actionCount++;
        if (actionCount > visibleActionCount) {
          // This action is not yet revealed - cut off here
          cutoffIdx = i;
          break;
        }
      }
    }

    visibleSegments = segments.slice(0, cutoffIdx);
  }

  // Group consecutive actions together
  const groupedSegments: { type: 'actions' | 'dialogue'; items: MessageSegment[]; startIndex: number }[] = [];
  let currentGroup: { type: 'actions' | 'dialogue'; items: MessageSegment[]; startIndex: number } | null = null;

  visibleSegments.forEach((segment, index) => {
    const groupType = segment.type === 'action' ? 'actions' : 'dialogue';
    if (!currentGroup || currentGroup.type !== groupType) {
      currentGroup = { type: groupType, items: [segment], startIndex: index };
      groupedSegments.push(currentGroup);
    } else {
      currentGroup.items.push(segment);
    }
  });

  // Track shimmer state for each action pill
  const [shimmerIndex, setShimmerIndex] = useState(0);

  // Stagger shimmer through action pills when new message
  useEffect(() => {
    if (!isNewMessage || actionSegments.length === 0) return;

    const timer = setInterval(() => {
      setShimmerIndex((prev) => {
        if (prev >= actionSegments.length - 1) {
          clearInterval(timer);
          return prev;
        }
        return prev + 1;
      });
    }, 1500);

    return () => clearInterval(timer);
  }, [isNewMessage, actionSegments.length]);

  // Get action index for shimmer tracking
  const getActionIndex = (startIndex: number, itemIndex: number) => {
    return segments.slice(0, startIndex + itemIndex + 1).filter(s => s.type === 'action').length - 1;
  };

  return (
    <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'} max-w-[80%]`}>
      {groupedSegments.map((group) => (
        <div
          key={`${messageId}-group-${group.startIndex}`}
          className={group.type === 'actions' ? 'flex flex-wrap gap-1.5' : ''}
        >
          {group.type === 'actions' ? (
            <AnimatePresence mode="popLayout">
              {group.items.map((segment, i) => {
                const actionIdx = getActionIndex(group.startIndex, i);
                const isShimmering = isNewMessage && actionIdx === shimmerIndex;
                return (
                  <motion.span
                    key={`${messageId}-${group.startIndex + i}`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className="inline-flex px-3 py-1.5 rounded-xl bg-muted/60 overflow-hidden relative"
                  >
                    <span className="text-xs text-campfire-400/80 whitespace-nowrap relative z-10">
                      {segment.content}
                    </span>
                    {isShimmering && (
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-campfire-400/30 to-transparent"
                        initial={{ x: '-100%' }}
                        animate={{ x: '100%' }}
                        transition={{ duration: 0.6, ease: 'easeInOut' }}
                      />
                    )}
                  </motion.span>
                );
              })}
            </AnimatePresence>
          ) : (
            group.items.map((segment, i) => {
              const actualIndex = group.startIndex + i;
              return (
                <span
                  key={`${messageId}-${actualIndex}`}
                  className={`inline-flex px-3 py-1.5 rounded-xl ${
                    isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  <span className="text-base lg:text-sm whitespace-pre-wrap">{segment.content}</span>
                  {showLikeButton && actualIndex === lastDialogueIndex && onLike && (
                    <span className="ml-2 -mr-1">
                      <LikeButton
                        turnId={messageId}
                        initialCount={likeCount || 0}
                        onLike={onLike}
                      />
                    </span>
                  )}
                </span>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
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

/** Demo companion data passed from demo page */
interface DemoCompanionData {
  id: string;
  name: string;
  avatarUrl: string | null;
  archetype: string | null;
  description: string | null;
}

interface ChatSessionContentProps {
  sessionId: string;
  /** Enable demo mode for anonymous users */
  isDemo?: boolean;
  /** Device fingerprint for anonymous auth (required when isDemo=true) */
  demoFingerprint?: string;
  /** Demo companion data (required when isDemo=true) */
  demoCompanion?: DemoCompanionData;
  /** Callback when message limit reached (demo mode only) */
  onLimitReached?: () => void;
  /** Callback when user tries to access a feature requiring auth (demo mode only) */
  onRequireAuth?: (trigger: SignupTrigger) => void;
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

export function ChatSessionContent({ sessionId, isDemo, demoFingerprint, demoCompanion, onLimitReached, onRequireAuth }: ChatSessionContentProps) {
  const router = useRouter();
  // In demo mode, skip auth redirect - pass null to useRequireAuth
  const authResult = useRequireAuth(isDemo ? null : '/login');
  // Override auth state in demo mode
  const isAuthenticated = isDemo ? true : authResult.isAuthenticated;
  const authLoading = isDemo ? false : authResult.isLoading;
  const user = useAuthStore((state) => state.user);
  // Demo mode state
  const [demoMessagesUsed, setDemoMessagesUsed] = useState(0);
  const DEMO_MESSAGE_LIMIT = 4;
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
  const [showVideoRequest, setShowVideoRequest] = useState(false);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [showGiftsPanel, setShowGiftsPanel] = useState(false);
  const [showFriendsPanel, setShowFriendsPanel] = useState(false);
  const [showMobileAvatar, setShowMobileAvatar] = useState(false);
  const [mobileGalleryImages, setMobileGalleryImages] = useState<GalleryImage[]>([]);
  const [mobileGalleryIndex, setMobileGalleryIndex] = useState(0);
  const [mobileGalleryLoading, setMobileGalleryLoading] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showGames, setShowGames] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [activeGame, setActiveGame] = useState<ActiveGame | null>(null);
  const [waitingForCompanionMove, setWaitingForCompanionMove] = useState(false);
  const [debugRefreshTrigger, setDebugRefreshTrigger] = useState(0);
  // Initialize companion with demo data when in demo mode
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
  // Track image generation - only generate after LLM response
  const [imageGenTrigger, setImageGenTrigger] = useState(0);
  // Dynamic avatar URL - synced with generated images (initialize with demo avatar)
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(
    isDemo && demoCompanion?.avatarUrl ? demoCompanion.avatarUrl : null
  );
  // Gallery images for random display on load
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [sceneDescription, setSceneDescription] = useState<string | undefined>(undefined);
  // Likes tracking
  const [messageLikes, setMessageLikes] = useState<Record<string, number>>({});
  const [sessionTotalLikes, setSessionTotalLikes] = useState(0);
  const [likeAnimationTrigger, setLikeAnimationTrigger] = useState(0);
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

  // Demo mode: Show initial greeting from companion with typing delay
  useEffect(() => {
    if (!isDemo || !demoCompanion || messages.length > 0) return;

    const greetings = [
      `Hey there! I'm ${demoCompanion.name}... what are you up to? 😊`,
      `Hi! I'm ${demoCompanion.name}. I've been waiting to meet someone like you... 💫`,
      `Well hello... I'm ${demoCompanion.name}. Something tells me we're going to get along really well 😏`,
      `*waves* Hey! I'm ${demoCompanion.name}. So... tell me about yourself? I'm curious 🌸`,
      `Hi cutie! I'm ${demoCompanion.name}. What's on your mind tonight? ✨`,
      `Oh hi! I'm ${demoCompanion.name}... I was just thinking about meeting someone new. Lucky me 😘`,
    ];

    const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];

    // Show typing indicator first
    setIsLoading(true);

    // Random delay between 1.5-2.5 seconds for realism
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

  // Voice call hook for continuous listening voice calls
  const {
    callState,
    isCallActive,
    isMuted: isCallMuted,
    currentTranscript,
    error: voiceCallError,
    startCall,
    endCall,
    toggleMute: toggleCallMute,
    getAnalyserNode: getCallAnalyserNode,
    // Token billing state
    currentBalance: voiceCallBalance,
    tokensUsed: voiceCallTokensUsed,
    insufficientTokens,
    clearInsufficientTokens,
  } = useVoiceCall(wsRef, audioPlayerRef, {
    onTranscription: (text, isFinal) => {
      if (isFinal && text.trim()) {
        // Add user's transcribed speech as a message
        const userMessage: Message = {
          id: crypto.randomUUID(),
          role: 'user',
          content: text,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMessage]);
      }
    },
    onError: (error) => {
      console.error('[Chat] Voice call error:', error);
    },
  });

  // Handle voice call button click
  const handleCallClick = useCallback(() => {
    if (isDemo && onRequireAuth) {
      onRequireAuth('call');
      return;
    }
    startCall();
  }, [isDemo, onRequireAuth, startCall]);

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

  const scrollToBottom = useCallback(() => {
    // Small delay to ensure DOM has updated with new content
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 50);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Load gallery images for mobile avatar modal
  // Skip in demo mode since we don't have auth - just show current avatar
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
        // Silently fail - will show current avatar instead
      } finally {
        setMobileGalleryLoading(false);
      }
    }

    loadMobileGallery();
  }, [showMobileAvatar, sessionId, isDemo]);

  // Load session, companion, and existing turns from API - wait for auth to be ready
  // Skip in demo mode since we create the session ourselves
  useEffect(() => {
    if (isDemo) return; // Demo mode doesn't need to load session data
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

            // Fetch token balance for video requests
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
  }, [sessionId, authLoading, isAuthenticated, isDemo]);

  // Fetch gallery images on load and pick a random one for display
  // Skip in demo mode since demo sessions don't have gallery images
  useEffect(() => {
    if (isDemo) return; // Demo mode doesn't need gallery
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
  }, [sessionId, authLoading, isAuthenticated, isDemo]);

  // Fallback to companion avatar if no gallery images
  useEffect(() => {
    if (!currentAvatarUrl && companion?.avatarUrl) {
      setCurrentAvatarUrl(companion.avatarUrl);
    }
  }, [companion?.avatarUrl, currentAvatarUrl]);

  // Connect to WebSocket - wait for auth to be ready (or demo mode)
  useEffect(() => {
    // In demo mode, we don't need to wait for auth
    if (!isDemo && (authLoading || !isAuthenticated)) return;

    // In demo mode, we need the fingerprint
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

    // Subscribe to ping (connection established) - then authenticate
    const unsubPing = ws.on('ping', () => {
      console.log('[Chat] WebSocket connected, authenticating...');
      if (isDemo && demoFingerprint) {
        ws.authenticateAnonymous(demoFingerprint);
      } else if (accessToken) {
        ws.authenticate(accessToken);
      }
    });

    // Subscribe to auth success - then resume session
    const unsubAuth = ws.on('auth_success', () => {
      console.log('[Chat] Authenticated via WebSocket, resuming session...');
      ws.resumeSession(sessionId);
    });

    // Subscribe to usage updates (demo mode)
    const unsubUsage = ws.onUsageUpdate?.((data) => {
      console.log('[Chat] Usage update:', data);
      setDemoMessagesUsed(data.messagesUsed);
    });

    // Subscribe to limit reached (demo mode)
    const unsubLimit = ws.onLimitReached?.((data) => {
      console.log('[Chat] Limit reached:', data);
      setDemoMessagesUsed(data.messagesUsed);
      onLimitReached?.();
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
          isNew: true,
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
    const unsubEnd = ws.onAgentMessageEnd((content, imagePrompt, sequence, turnId) => {
      const emotionalState = detectEmotionalState(content);

      // Build message ID: use turnId-agent format to match historical messages
      // For multi-message sequences, append index to ensure uniqueness
      let messageId: string;
      if (turnId) {
        messageId = sequence ? `${turnId}-agent-${sequence.index}` : `${turnId}-agent`;
      } else {
        messageId = crypto.randomUUID();
      }

      // Add message immediately - use turnId from backend for liking support
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
      // Store likes with both the raw turnId and the synthetic -agent suffix
      // so lookups work for both new messages (raw UUID) and historical messages (uuid-agent)
      setMessageLikes((prev) => ({
        ...prev,
        [turnId]: turnLikes,
        [`${turnId}-agent`]: turnLikes,
      }));
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

      // Build unique message ID: include companionId to differentiate group chat messages
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
          themeColor: companion?.themeColor || '#8B5CF6',
          isReaction,
          isNew: true,
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
  }, [sessionId, authLoading, isAuthenticated, isDemo, demoFingerprint, onLimitReached]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isLoading) return;

    // In demo mode, check if limit reached and show signup modal instead of sending
    if (isDemo && demoMessagesUsed >= DEMO_MESSAGE_LIMIT) {
      onLimitReached?.();
      return;
    }

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

    // Send via WebSocket with auto-retry for iOS keyboard race condition
    if (wsRef.current) {
      wsRef.current.sendMessageWithRetry(input.trim());
    } else {
      console.error('WebSocket not initialized');
      setIsLoading(false);
    }

    // Refocus the input for continued typing (setTimeout needed for iOS)
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  }, [input, isLoading, isDemo, demoMessagesUsed, onLimitReached]);

  // Handle liking a message
  const handleLikeMessage = useCallback((messageId: string) => {
    if (!wsRef.current?.isConnected) return;
    // Extract the turn UUID from message ID formats:
    // - Historical: {turnId}-agent, {turnId}-user
    // - Streaming: {turnId}-agent, {turnId}-agent-{index}
    // - Group chat: {turnId}-{companionId}
    const uuidPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    const match = messageId.match(uuidPattern);
    if (!match) {
      console.warn('[Chat] Cannot like message with non-UUID id:', messageId);
      return;
    }
    const turnId = match[1];
    wsRef.current.likeMessage(turnId);
    // Trigger heart animation in companion avatar area
    setLikeAnimationTrigger((prev) => prev + 1);
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
    <div className="flex h-dvh bg-background overflow-x-hidden">
      {/* Companion Avatar Sidebar */}
      <div
        ref={sidebarRef}
        className="hidden lg:flex flex-col items-center p-4 bg-muted/10 relative select-none overflow-y-auto overflow-x-hidden scrollbar-subtle"
        style={{ width: sidebarWidth }}
        onMouseMove={handleMouseMoveNearGrabber}
        onMouseLeave={handleMouseLeaveGrabber}
      >
        {/* Voice Call Sidebar - shown when call is active */}
        {isCallActive && companion ? (
          <CallSidebar
            companionName={companion.name}
            companionAvatarUrl={currentAvatarUrl || companion.avatarUrl}
            callState={callState}
            isMuted={isCallMuted}
            currentTranscript={currentTranscript}
            analyserNode={getCallAnalyserNode()}
            onEndCall={endCall}
            onToggleMute={toggleCallMute}
          />
        ) : (
          <>
        {/* Only render CompanionAvatar once we have companion data with anchor image */}
        {companion?.avatarUrl ? (
          <button
            onClick={() => {
              if (isDemo && onRequireAuth) {
                onRequireAuth('gallery');
              } else {
                setShowGallery(true);
              }
            }}
            className="relative cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-campfire-500 focus:ring-offset-2 focus:ring-offset-background rounded-xl overflow-hidden"
            style={{ width: avatarDimensions.width, height: avatarDimensions.height }}
            aria-label="View gallery"
          >
            <CompanionAvatar
              emotionalState={currentEmotionalState}
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
            <LikeHeartsAnimation trigger={likeAnimationTrigger} />
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

        {/* Voice Call Button */}
        <div className="w-full px-2 mt-3">
          <CallButton onClick={handleCallClick} disabled={isCallActive} />
        </div>

        {/* Video Request Button */}
        <div className="w-full px-2 mt-2">
          <VideoRequestButton
            onClick={() => {
              if (isDemo && onRequireAuth) {
                onRequireAuth('video');
              } else {
                setShowVideoRequest(true);
              }
            }}
            disabled={isCallActive}
          />
        </div>

        <div className="flex flex-col gap-2.5 mt-4 w-full px-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 px-5 py-4 text-base"
            onClick={() => {
              if (isDemo && onRequireAuth) {
                onRequireAuth('personality');
              } else {
                setShowPersonality(true);
              }
            }}
          >
            <Sparkles className="h-5 w-5" />
            Personality
          </Button>
          {backstoryData?.hasBackstory && (
            <Button
              variant="outline"
              className="w-full justify-start gap-3 px-5 py-4 text-base border-amber-700/30 text-amber-500 hover:bg-amber-900/20 hover:text-amber-400"
              onClick={() => {
                if (isDemo && onRequireAuth) {
                  onRequireAuth('avatar');
                } else {
                  setShowBackstory(true);
                }
              }}
            >
              <BookOpen className="h-5 w-5" />
              Backstory
            </Button>
          )}
          <Button
            variant="outline"
            className="w-full justify-start gap-3 px-5 py-4 text-base border-cyan-700/30 text-cyan-500 hover:bg-cyan-900/20 hover:text-cyan-400"
            onClick={() => {
              if (isDemo && onRequireAuth) {
                onRequireAuth('games');
              } else {
                setShowGames(true);
              }
            }}
          >
            <Gamepad2 className="h-5 w-5" />
            Games
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3 px-5 py-4 text-base border-rose-700/30 text-rose-500 hover:bg-rose-900/20 hover:text-rose-400"
            onClick={() => {
              if (isDemo && onRequireAuth) {
                onRequireAuth('gifts');
              } else {
                setShowGiftsPanel(true);
              }
            }}
          >
            <Gift className="h-5 w-5" />
            Gifts
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3 px-5 py-4 text-base border-purple-700/30 text-purple-500 hover:bg-purple-900/20 hover:text-purple-400"
            onClick={() => {
              if (isDemo && onRequireAuth) {
                onRequireAuth('friends');
              } else {
                setShowFriendsPanel(true);
              }
            }}
          >
            <Users className="h-5 w-5" />
            Friends
          </Button>
        </div>

        {/* Spacer to push webcam to bottom */}
        <div className="flex-1" />

        {/* Design Companion button at bottom */}
        <div className="w-full px-2 mb-4">
          <Button
            variant="default"
            className="w-full justify-center gap-2 py-5 text-base bg-gradient-to-r from-campfire-500 to-campfire-600 hover:from-campfire-600 hover:to-campfire-700 shadow-lg"
            onClick={() => {
              router.push('/onboard');
            }}
          >
            <Sparkles className="h-5 w-5" />
            Design Companion
          </Button>
        </div>
          </>
        )}

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
      <div className="flex flex-col flex-1 min-w-0 overflow-x-hidden">
        {/* Header - fixed transparent on mobile */}
        <header className="px-4 py-3 flex items-center gap-4 lg:relative fixed top-0 left-0 right-0 z-50 lg:bg-transparent bg-transparent lg:backdrop-blur-none backdrop-blur-sm">
          <Link href="/dashboard" className="flex items-center gap-2">
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
            {user?.role === 'admin' && (
              <Button
                variant={showDebugPanel ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setShowDebugPanel(!showDebugPanel)}
                title="Toggle Debug Panel"
              >
                <Bug className="h-4 w-4" />
              </Button>
            )}
            {user?.role !== 'admin' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSupportModal(true)}
                title="Get Help"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            )}
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" title="Close">
                <X className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          {/* Mobile hamburger menu */}
          <div className="lg:hidden relative">
            <motion.button
              className="relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-accent/80 transition-colors"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              title="Menu"
              whileTap={{ scale: 0.92 }}
            >
              <div className="flex flex-col justify-center items-center w-6 h-5">
                <motion.span
                  className="absolute block h-0.5 w-5 bg-foreground rounded-full"
                  animate={{
                    rotate: showMobileMenu ? 45 : 0,
                    y: showMobileMenu ? 0 : -6,
                  }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                />
                <motion.span
                  className="absolute block h-0.5 w-5 bg-foreground rounded-full"
                  animate={{
                    opacity: showMobileMenu ? 0 : 1,
                    scaleX: showMobileMenu ? 0 : 1,
                  }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                />
                <motion.span
                  className="absolute block h-0.5 w-5 bg-foreground rounded-full"
                  animate={{
                    rotate: showMobileMenu ? -45 : 0,
                    y: showMobileMenu ? 0 : 6,
                  }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                />
              </div>
            </motion.button>

            {/* Mobile dropdown menu */}
            <AnimatePresence>
              {showMobileMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  className="absolute right-0 top-full mt-2 bg-background/95 backdrop-blur-md border rounded-xl shadow-xl p-3 min-w-[200px] space-y-1"
                >
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 h-12 text-base px-4 text-campfire-500"
                    onClick={() => {
                      setShowMobileMenu(false);
                      router.push('/onboard');
                    }}
                  >
                    <Sparkles className="h-5 w-5" />
                    New Chat
                  </Button>
                  <div className="border-t my-2" />
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 h-12 text-base px-4"
                    onClick={() => {
                      setShowMobileMenu(false);
                      if (isDemo && onRequireAuth) {
                        onRequireAuth('gallery');
                      } else {
                        setShowGallery(true);
                      }
                    }}
                  >
                    <Images className="h-5 w-5" />
                    Gallery
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 h-12 text-base px-4"
                    onClick={() => {
                      setShowMobileMenu(false);
                      if (isDemo && onRequireAuth) {
                        onRequireAuth('gifts');
                      } else {
                        setShowGiftsPanel(!showGiftsPanel);
                      }
                    }}
                  >
                    <Gift className="h-5 w-5" />
                    Gifts
                  </Button>
                  {user?.role === 'admin' && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-3 h-12 text-base px-4"
                      onClick={() => {
                        setShowMobileMenu(false);
                        if (isDemo && onRequireAuth) {
                          onRequireAuth('debug');
                        } else {
                          setShowDebugPanel(!showDebugPanel);
                        }
                      }}
                    >
                      <Bug className="h-5 w-5" />
                      Debug
                    </Button>
                  )}
                  {user?.role !== 'admin' && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-3 h-12 text-base px-4"
                      onClick={() => {
                        setShowMobileMenu(false);
                        setShowSupportModal(true);
                      }}
                    >
                      <HelpCircle className="h-5 w-5" />
                      Support
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 h-12 text-base px-4"
                    onClick={() => {
                      setShowMobileMenu(false);
                      if (isDemo && onRequireAuth) {
                        onRequireAuth('account');
                      } else {
                        router.push('/account');
                      }
                    }}
                  >
                    <User className="h-5 w-5" />
                    Account
                  </Button>
                  <div className="border-t my-2" />
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 h-12 text-base px-4 text-muted-foreground"
                    onClick={() => {
                      setShowMobileMenu(false);
                      if (isDemo && onRequireAuth) {
                        onRequireAuth('close');
                      } else {
                        router.push('/dashboard');
                      }
                    }}
                  >
                    <X className="h-5 w-5" />
                    Close
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        {/* Spacer for fixed header on mobile */}
        <div className="h-14 lg:hidden" />

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto py-4 px-6 lg:px-4 space-y-4 scrollbar-chat"
          style={{ paddingBottom: keyboardHeight > 0 ? `${keyboardHeight + 80}px` : undefined }}
        >
          {messages.length === 0 && !streamingContent && !isLoading && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Start a conversation with your companion
            </div>
          )}
          {messages.map((message) => {
            const isUser = message.role === 'user';
            const segments = isUser ? null : parseMessageSegments(message.content);
            const hasMultipleSegments = segments && segments.length > 1;

            return (
              <div
                key={message.id}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {/* Use animated segments for assistant messages with actions */}
                {!isUser && hasMultipleSegments ? (
                  <AnimatedMessageSegments
                    segments={segments}
                    isUser={false}
                    messageId={message.id}
                    showLikeButton={!isDemo}
                    likeCount={messageLikes[message.id] || 0}
                    onLike={handleLikeMessage}
                    isNewMessage={message.isNew}
                    onSegmentReveal={scrollToBottom}
                  />
                ) : (
                  <Card
                    className={`max-w-[80%] p-3 ${
                      isUser
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    <p className="text-base lg:text-sm whitespace-pre-wrap">{message.content}</p>
                    {!isUser && !isDemo && (
                      <div className="flex justify-end mt-1 -mb-1 -mr-1">
                        <LikeButton
                          turnId={message.id}
                          initialCount={messageLikes[message.id] || 0}
                          onLike={handleLikeMessage}
                        />
                      </div>
                    )}
                  </Card>
                )}
              </div>
            );
          })}
          {/* Streaming message */}
          {streamingContent && (
            <div className="flex justify-start">
              <Card className="bg-muted p-3 max-w-[80%]">
                <p className="text-base lg:text-sm whitespace-pre-wrap">{streamingContent}</p>
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
        <div ref={inputContainerRef} className="py-4 px-6 lg:px-4 bg-background z-40">
          {/* Mobile Action Bar - above input */}
          <div className="lg:hidden pb-3 -mx-6 px-6 overflow-x-auto scrollbar-hide">
            <div className="flex gap-2 w-max">
              <Button
                variant="outline"
                className="flex-shrink-0 gap-2 px-4 py-3 h-auto border-emerald-700/30 text-emerald-500 hover:bg-emerald-900/20 hover:text-emerald-400"
                onClick={handleCallClick}
                disabled={isCallActive}
              >
                <Phone className="h-4 w-4" />
                <span className="text-sm">Call</span>
              </Button>
              <Button
                variant="outline"
                className="flex-shrink-0 gap-2 px-4 py-3 h-auto"
                onClick={() => {
                  if (isDemo && onRequireAuth) {
                    onRequireAuth('personality');
                  } else {
                    setShowPersonality(true);
                  }
                }}
              >
                <Sparkles className="h-4 w-4" />
                <span className="text-sm">Personality</span>
              </Button>
              {backstoryData?.hasBackstory && (
                <Button
                  variant="outline"
                  className="flex-shrink-0 gap-2 px-4 py-3 h-auto border-amber-700/30 text-amber-500 hover:bg-amber-900/20 hover:text-amber-400"
                  onClick={() => {
                    if (isDemo && onRequireAuth) {
                      onRequireAuth('avatar');
                    } else {
                      setShowBackstory(true);
                    }
                  }}
                >
                  <BookOpen className="h-4 w-4" />
                  <span className="text-sm">Backstory</span>
                </Button>
              )}
              <Button
                variant="outline"
                className="flex-shrink-0 gap-2 px-4 py-3 h-auto border-cyan-700/30 text-cyan-500 hover:bg-cyan-900/20 hover:text-cyan-400"
                onClick={() => {
                  if (isDemo && onRequireAuth) {
                    onRequireAuth('games');
                  } else {
                    setShowGames(true);
                  }
                }}
              >
                <Gamepad2 className="h-4 w-4" />
                <span className="text-sm">Games</span>
              </Button>
              <Button
                variant="outline"
                className="flex-shrink-0 gap-2 px-4 py-3 h-auto border-rose-700/30 text-rose-500 hover:bg-rose-900/20 hover:text-rose-400"
                onClick={() => {
                  if (isDemo && onRequireAuth) {
                    onRequireAuth('gifts');
                  } else {
                    setShowGiftsPanel(true);
                  }
                }}
              >
                <Gift className="h-4 w-4" />
                <span className="text-sm">Gifts</span>
              </Button>
              <Button
                variant="outline"
                className="flex-shrink-0 gap-2 px-4 py-3 h-auto border-purple-700/30 text-purple-500 hover:bg-purple-900/20 hover:text-purple-400"
                onClick={() => {
                  if (isDemo && onRequireAuth) {
                    onRequireAuth('friends');
                  } else {
                    setShowFriendsPanel(true);
                  }
                }}
              >
                <Users className="h-4 w-4" />
                <span className="text-sm">Friends</span>
              </Button>
            </div>
          </div>

          {/* Live transcription display */}
          {liveTranscription && (
            <div className="w-full lg:max-w-4xl lg:mx-auto mb-2">
              <Card className="p-2 bg-muted/50 border-dashed">
                <p className="text-sm text-muted-foreground italic">{liveTranscription}</p>
              </Card>
            </div>
          )}

          {/* Voice error display */}
          {voiceError && (
            <div className="w-full lg:max-w-4xl lg:mx-auto mb-2">
              <Card className="p-2 bg-destructive/10 border-destructive/50">
                <p className="text-sm text-destructive">{voiceError}</p>
              </Card>
            </div>
          )}

          {/* Webcam error display */}
          {webcamError && (
            <div className="w-full lg:max-w-4xl lg:mx-auto mb-2">
              <Card className="p-2 bg-destructive/10 border-destructive/50">
                <p className="text-sm text-destructive">{webcamError}</p>
              </Card>
            </div>
          )}

          <div className="flex gap-2 w-full lg:max-w-4xl lg:mx-auto">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
              placeholder={voiceModeEnabled ? 'Type or hold mic to speak...' : 'Type a message...'}
              readOnly={isLoading || isRecording}
              className={`flex-1 min-w-0 h-12 lg:h-10 text-base lg:text-sm transition-shadow duration-300 ${
                !hasShownPulse && input.length === 0
                  ? 'focus:animate-campfire-pulse'
                  : ''
              }`}
            />
            <Button
              onClick={handleSend}
              onMouseDown={(e) => e.preventDefault()}
              disabled={!input.trim() || isLoading || isRecording}
              className="h-12 w-12 lg:h-10 lg:w-10 flex-shrink-0 rounded-full"
            >
              <ArrowRight className="h-7 w-7 lg:h-5 lg:w-5" />
            </Button>
          </div>

          {/* TTS playback indicator */}
          {isTTSPlaying && (
            <div className="w-full lg:max-w-4xl lg:mx-auto mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
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

        {/* Mobile/Tablet Floating Avatar with Expandable Gallery */}
        {currentAvatarUrl && (
          <>
            {/* Backdrop when expanded */}
            <AnimatePresence>
              {showMobileAvatar && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="lg:hidden fixed inset-0 z-40 bg-black/80 backdrop-blur-sm"
                  onClick={() => setShowMobileAvatar(false)}
                />
              )}
            </AnimatePresence>

            {/* Avatar container - expands in place */}
            <motion.div
              layoutId="mobile-avatar"
              onClick={() => setShowMobileAvatar(!showMobileAvatar)}
              className={`lg:hidden fixed z-50 rounded-xl overflow-hidden border-2 border-campfire-500 shadow-xl bg-muted cursor-pointer ${
                showMobileAvatar
                  ? 'inset-4 top-16 bottom-auto max-h-[70vh]'
                  : 'right-4 w-[120px] h-[144px]'
              }`}
              style={!showMobileAvatar ? { bottom: keyboardHeight > 0 ? `${keyboardHeight + 150}px` : '150px' } : undefined}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              {/* Swipeable gallery when expanded */}
              {showMobileAvatar ? (
                <motion.div
                  className="w-full h-full"
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.2}
                  onDragEnd={(_, info) => {
                    const swipeThreshold = 50;
                    if (info.offset.x < -swipeThreshold && mobileGalleryIndex < mobileGalleryImages.length - 1) {
                      if (isDemo && onRequireAuth) {
                        onRequireAuth('gallery');
                      } else {
                        setMobileGalleryIndex(mobileGalleryIndex + 1);
                      }
                    } else if (info.offset.x > swipeThreshold && mobileGalleryIndex > 0) {
                      if (isDemo && onRequireAuth) {
                        onRequireAuth('gallery');
                      } else {
                        setMobileGalleryIndex(mobileGalleryIndex - 1);
                      }
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <AnimatePresence mode="wait">
                    <motion.img
                      key={mobileGalleryIndex}
                      src={mobileGalleryImages.length > 0 && mobileGalleryImages[mobileGalleryIndex]
                        ? mobileGalleryImages[mobileGalleryIndex].s3_url
                        : currentAvatarUrl}
                      alt={companion?.name || 'Companion'}
                      className="w-full h-full object-cover"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      draggable={false}
                    />
                  </AnimatePresence>

                  {/* Close button */}
                  <button
                    onClick={() => setShowMobileAvatar(false)}
                    className="absolute top-3 right-3 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
                  >
                    <X className="h-5 w-5" />
                  </button>

                  {/* Navigation arrows */}
                  {mobileGalleryImages.length > 1 && mobileGalleryIndex > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMobileGalleryIndex(mobileGalleryIndex - 1);
                      }}
                      className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                  )}
                  {mobileGalleryImages.length > 1 && mobileGalleryIndex < mobileGalleryImages.length - 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMobileGalleryIndex(mobileGalleryIndex + 1);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  )}

                  {/* Dot indicators */}
                  {mobileGalleryImages.length > 1 && (
                    <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5">
                      {mobileGalleryImages.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMobileGalleryIndex(idx);
                          }}
                          className={`w-2 h-2 rounded-full transition-colors ${
                            idx === mobileGalleryIndex
                              ? 'bg-campfire-500'
                              : 'bg-white/40 hover:bg-white/60'
                          }`}
                        />
                      ))}
                    </div>
                  )}

                  {/* Companion name overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/60 to-transparent">
                    <p className="text-white font-medium">
                      {companion?.name}
                      {mobileGalleryImages.length > 0 && mobileGalleryImages[mobileGalleryIndex] && (
                        <span className="ml-2 text-white/70 capitalize font-normal">
                          • {mobileGalleryImages[mobileGalleryIndex].emotional_state}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Loading state */}
                  {mobileGalleryLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <div className="w-8 h-8 border-2 border-campfire-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </motion.div>
              ) : (
                <img
                  src={currentAvatarUrl}
                  alt={companion?.name || 'Companion'}
                  className="w-full h-full object-cover"
                />
              )}
              <LikeHeartsAnimation trigger={likeAnimationTrigger} />
            </motion.div>
          </>
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

      {/* Video Request Modal */}
      <VideoRequestModal
        isOpen={showVideoRequest}
        onClose={() => setShowVideoRequest(false)}
        companionId={companion?.id || ''}
        companionName={companion?.name || ''}
        sessionId={sessionId}
        avatarUrl={companion?.avatarUrl || undefined}
        tokenBalance={tokenBalance}
        onSuccess={(videoRequestId, newBalance) => {
          setTokenBalance(newBalance);
          toast.success('Video request submitted! Check your Media Gallery for updates.');
        }}
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

      {/* Insufficient Tokens Modal (Voice Call) */}
      <InsufficientTokensModal
        isOpen={insufficientTokens}
        onClose={clearInsufficientTokens}
        currentBalance={voiceCallBalance ?? 0}
      />

      {/* Support Modal */}
      <SupportModal
        open={showSupportModal}
        onOpenChange={setShowSupportModal}
      />
    </div>
  );
}
