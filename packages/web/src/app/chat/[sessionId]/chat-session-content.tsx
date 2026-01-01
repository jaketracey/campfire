'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Send, Mic, MicOff, Bug } from 'lucide-react';
import Link from 'next/link';
import { getSessionTurns } from '@/lib/api';
import { CampfireWebSocket, connectWebSocket } from '@/lib/ws';
import { CompanionAvatar } from '@/components/companion';
import { DebugPanel } from '@/components/debug-panel';
import type { EmotionalState } from '@/lib/api/imagegen';

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

export function ChatSessionContent({ sessionId }: ChatSessionContentProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [currentEmotionalState, setCurrentEmotionalState] = useState<EmotionalState>('neutral');
  const [showAvatar, setShowAvatar] = useState(true);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugRefreshTrigger, setDebugRefreshTrigger] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<CampfireWebSocket | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent]);

  // Load existing turns from API
  useEffect(() => {
    async function loadHistory() {
      try {
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
        console.error('Failed to load history:', error);
      }
    }

    loadHistory();
  }, [sessionId]);

  // Connect to WebSocket
  useEffect(() => {
    const ws = connectWebSocket();
    wsRef.current = ws;

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

    // Subscribe to connection state
    const unsubConnected = ws.on('ping', () => {
      setWsConnected(true);
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
      // Trigger debug panel refresh
      setDebugRefreshTrigger((prev) => prev + 1);
    });

    // Subscribe to errors
    const unsubError = ws.onError((message) => {
      console.error('[Chat] WebSocket error:', message);
      setIsLoading(false);
    });

    ws.connect();

    return () => {
      unsubAuth();
      unsubSessionStarted();
      unsubConnected();
      unsubAgent();
      unsubChunk();
      unsubEnd();
      unsubError();
      ws.disconnect();
    };
  }, [sessionId]);

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
  }, [input, isLoading]);

  const toggleVoice = () => {
    setIsListening(!isListening);
    // TODO: Implement voice input via WebSocket
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Companion Avatar Sidebar */}
      {showAvatar && (
        <div className="hidden lg:flex flex-col items-center p-4 border-r bg-muted/30 w-[280px]">
          <CompanionAvatar
            emotionalState={currentEmotionalState}
            style="stylized"
            width={250}
            height={400}
            autoRegenerate={true}
            debounceDelay={2000}
            className="shadow-lg"
          />
          <p className="mt-3 text-sm text-muted-foreground">
            Feeling: <span className="font-medium text-foreground capitalize">{currentEmotionalState}</span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setShowAvatar(false)}
          >
            Hide Avatar
          </Button>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex flex-col flex-1">
        {/* Header */}
        <header className="border-b px-4 py-3 flex items-center gap-4">
          <Link href="/chat">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="font-semibold">Companion Chat</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Session: {sessionId.slice(0, 8)}...</span>
              <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span>{wsConnected ? 'Connected' : 'Connecting...'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!showAvatar && (
              <Button variant="outline" size="sm" onClick={() => setShowAvatar(true)}>
                Show Avatar
              </Button>
            )}
            <Button
              variant={showDebugPanel ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setShowDebugPanel(!showDebugPanel)}
              title="Toggle Debug Panel"
            >
              <Bug className="h-4 w-4" />
            </Button>
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
      </div>

      {/* Debug Panel */}
      <DebugPanel
        sessionId={sessionId}
        isOpen={showDebugPanel}
        onClose={() => setShowDebugPanel(false)}
        refreshTrigger={debugRefreshTrigger}
      />
    </div>
  );
}
