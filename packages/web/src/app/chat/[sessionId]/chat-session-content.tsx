'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { X, Send, Mic, MicOff, Bug, Images, Flame, Sparkles, Gift, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { getSessionTurns, getSession, getCompanion, getCompanionBackstory, type Companion, type CompanionBackstory } from '@/lib/api';
import { CampfireWebSocket, connectWebSocket } from '@/lib/ws';
import { CompanionAvatar, StaticCompanionAvatar, CompanionGallery, PersonalityModal, BackstoryModal } from '@/components/companion';
import { DebugPanel } from '@/components/debug-panel';
import { GiftsPanel } from '@/components/gifts';
import { useRequireAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { buildPromptFromCompanion, type EmotionalState } from '@/lib/api/imagegen';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  emotionalState?: EmotionalState;
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
  const [isListening, setIsListening] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [currentEmotionalState, setCurrentEmotionalState] = useState<EmotionalState>('neutral');
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showPersonality, setShowPersonality] = useState(false);
  const [showBackstory, setShowBackstory] = useState(false);
  const [showGiftsPanel, setShowGiftsPanel] = useState(false);
  const [showMobileAvatar, setShowMobileAvatar] = useState(false);
  const [debugRefreshTrigger, setDebugRefreshTrigger] = useState(0);
  const [companion, setCompanion] = useState<Companion | null>(null);
  const [backstoryData, setBackstoryData] = useState<CompanionBackstory | null>(null);
  // Track image generation - only generate after LLM response
  const [imageGenTrigger, setImageGenTrigger] = useState(0);
  const [sceneDescription, setSceneDescription] = useState<string | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<CampfireWebSocket | null>(null);

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

        // Load companion with full spec (including visual data)
        if (session.companionId) {
          try {
            const companionData = await getCompanion(session.companionId);
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
    const unsubSessionStarted = ws.on('session_started', () => {
      setWsConnected(true);
      console.log('[Chat] Session resumed via WebSocket');
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

    // Subscribe to message end
    const unsubEnd = ws.onAgentMessageEnd((content) => {
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

    // Subscribe to errors
    const unsubError = ws.onError((message) => {
      console.error('[Chat] WebSocket error:', message);
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

    // Refocus the input for continued typing
    inputRef.current?.focus();
  }, [input, isLoading]);

  const toggleVoice = () => {
    setIsListening(!isListening);
    // TODO: Implement voice input via WebSocket
  };

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
      <div className="hidden lg:flex flex-col items-center p-4 border-r bg-muted/30 w-[280px]">
        <CompanionAvatar
          emotionalState={currentEmotionalState}
          style="stylized"
          customPrompt={customPrompt}
          width={250}
          height={400}
          autoRegenerate={false}
          debounceDelay={2000}
          className="shadow-lg"
          userId={user?.id}
          sessionId={sessionId}
          companionId={companion?.id}
          anchorImageUrl={companion?.avatarUrl || undefined}
          generationTrigger={imageGenTrigger}
          sceneDescription={sceneDescription}
        />
        <p className="mt-3 text-sm text-muted-foreground">
          Feeling: <span className="font-medium text-foreground capitalize">{currentEmotionalState}</span>
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setShowGallery(true)}
          >
            <Images className="h-4 w-4" />
            Gallery
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setShowPersonality(true)}
          >
            <Sparkles className="h-4 w-4" />
            Personality
          </Button>
          {backstoryData?.hasBackstory && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 border-amber-700/30 text-amber-500 hover:bg-amber-900/20 hover:text-amber-400"
              onClick={() => setShowBackstory(true)}
            >
              <BookOpen className="h-4 w-4" />
              Backstory
            </Button>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex flex-col flex-1">
        {/* Header */}
        <header className="border-b px-4 py-3 flex items-center gap-4">
          <Link href="/chat" className="flex items-center gap-2">
            <Flame className="h-7 w-7 text-campfire-500" />
            <span className="text-lg font-bold">Campfire</span>
          </Link>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
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
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
          {/* Loading indicator */}
          {isLoading && !streamingContent && (
            <div className="flex justify-start">
              <Card className="bg-muted p-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-foreground/50 rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-foreground/50 rounded-full animate-bounce [animation-delay:0.1s]" />
                  <span className="w-2 h-2 bg-foreground/50 rounded-full animate-bounce [animation-delay:0.2s]" />
                </div>
              </Card>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t p-4">
          <div className="flex gap-2 max-w-4xl mx-auto">
            <Button
              variant={isListening ? 'destructive' : 'outline'}
              size="icon"
              onClick={toggleVoice}
            >
              {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Type a message..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button onClick={handleSend} disabled={!input.trim() || isLoading}>
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Mobile/Tablet Floating Avatar Thumbnail */}
        {companion?.avatarUrl && (
          <button
            onClick={() => setShowMobileAvatar(true)}
            className="lg:hidden fixed bottom-24 right-4 z-40 w-16 h-16 rounded-full overflow-hidden border-2 border-campfire-500 shadow-lg bg-muted/80 backdrop-blur-sm hover:scale-105 transition-transform"
            aria-label="View companion"
          >
            <StaticCompanionAvatar
              imageUrl={companion.avatarUrl}
              width={64}
              height={64}
              className="w-full h-full rounded-full"
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
            {companion?.avatarUrl && (
              <StaticCompanionAvatar
                imageUrl={companion.avatarUrl}
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
