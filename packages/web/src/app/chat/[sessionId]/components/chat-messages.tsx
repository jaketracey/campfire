'use client';

import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { LikeButton } from '@/components/likes';
import { GameBoardContainer } from '@/components/games';
import type { ActiveGame } from '@campfire/shared';
import type { Message } from '../types';
import { parseMessageSegments, shouldShowDateSeparator, dateSeparatorLabel, formatMessageTime } from '../utils';
import { AnimatedMessageSegments } from './animated-message-segments';
import { GiftMessage } from './gift-message';

interface ChatMessagesProps {
  messages: Message[];
  streamingContent: string;
  isLoading: boolean;
  showTypingBetweenMessages: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  keyboardHeight: number;

  // Likes
  messageLikes: Record<string, number>;
  onLikeMessage: (messageId: string) => void;
  scrollToBottom: () => void;

  // Game
  activeGame: ActiveGame | null;
  waitingForCompanionMove: boolean;
  companionName: string;
  onUserMove: (move: string) => void;
  onResign: () => void;

  // Demo mode
  isDemo?: boolean;

  // Mobile background avatar
  mobileAvatarUrl?: string | null;
  onMobileAvatarClick?: () => void;

  // Conversation starters
  onStarterClick?: (text: string) => void;
}

export function ChatMessages({
  messages,
  streamingContent,
  isLoading,
  showTypingBetweenMessages,
  messagesEndRef,
  keyboardHeight,
  messageLikes,
  onLikeMessage,
  scrollToBottom,
  activeGame,
  waitingForCompanionMove,
  companionName,
  onUserMove,
  onResign,
  isDemo,
  mobileAvatarUrl,
  onMobileAvatarClick,
  onStarterClick,
}: ChatMessagesProps) {
  const conversationStarters = [
    'Tell me about yourself',
    'What do you enjoy?',
    'Surprise me with something fun',
  ];
  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
      className="flex-1 overflow-y-auto py-4 px-6 lg:px-4 space-y-4 scrollbar-chat relative pb-36 lg:pb-4"
      style={{ paddingBottom: keyboardHeight > 0 ? `${keyboardHeight + 80}px` : undefined }}
      data-testid="chat-messages"
    >
      {/* Mobile background avatar */}
      {mobileAvatarUrl && (
        <div
          className="lg:hidden fixed inset-0 z-0 pointer-events-none"
          style={{ top: '56px' }}
        >
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${mobileAvatarUrl})` }}
          />
          {/* Animated overlay - starts bright (20% opacity) then darkens to 85% */}
          <motion.div
            className="absolute inset-0 bg-background"
            initial={{ opacity: 0.2 }}
            animate={{ opacity: 0.85 }}
            transition={{ duration: 2, ease: 'easeOut' }}
          />
          {/* Clickable overlay to expand avatar */}
          <button
            onClick={onMobileAvatarClick}
            className="absolute top-4 right-4 w-16 h-16 rounded-xl overflow-hidden border-2 border-campfire-500/50 shadow-lg pointer-events-auto hover:border-campfire-500 transition-colors"
            aria-label="View full image"
          >
            <img
              src={mobileAvatarUrl}
              alt={companionName}
              className="w-full h-full object-cover"
            />
          </button>
        </div>
      )}
      {messages.length === 0 && !streamingContent && !isLoading && (
        <div className="flex flex-col items-center justify-center h-full relative z-10 gap-6" data-testid="chat-empty-state">
          <p className="text-lg text-muted-foreground">
            Say hi to <span className="text-foreground font-medium">{companionName}</span>!
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {conversationStarters.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => onStarterClick?.(starter)}
                className="px-4 py-2 rounded-full border border-border bg-muted/50 text-sm text-muted-foreground hover:bg-muted hover:text-foreground hover:border-foreground/20 transition-colors"
              >
                {starter}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((message, index) => {
        const prevTimestamp = index > 0 ? messages[index - 1].timestamp : null;
        const showSeparator = shouldShowDateSeparator(message.timestamp, prevTimestamp);

        // Handle gift messages specially
        if (message.giftData) {
          return (
            <div key={message.id} className="relative z-10">
              {showSeparator && (
                <div className="flex justify-center mb-4">
                  <span className="text-[11px] text-muted-foreground/60 bg-muted/50 px-3 py-1 rounded-full">
                    {dateSeparatorLabel(message.timestamp)}
                  </span>
                </div>
              )}
              <GiftMessage
                giftData={message.giftData}
                isNew={message.isNew}
              />
            </div>
          );
        }

        const isUser = message.role === 'user';
        const segments = isUser ? null : parseMessageSegments(message.content);
        const hasMultipleSegments = segments && segments.length > 1;

        return (
          <div key={message.id} className="relative z-10">
            {showSeparator && (
              <div className="flex justify-center mb-4">
                <span className="text-[11px] text-muted-foreground/60 bg-muted/50 px-3 py-1 rounded-full">
                  {dateSeparatorLabel(message.timestamp)}
                </span>
              </div>
            )}
            <div
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
              data-testid={isUser ? 'user-message' : 'assistant-message'}
            >
              <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[80%] lg:max-w-xl`}>
                {!isUser && hasMultipleSegments ? (
                  <AnimatedMessageSegments
                    segments={segments}
                    isUser={false}
                    messageId={message.id}
                    showLikeButton={!isDemo}
                    likeCount={messageLikes[message.id] || 0}
                    onLike={onLikeMessage}
                    isNewMessage={message.isNew}
                    onSegmentReveal={scrollToBottom}
                  />
                ) : (
                  <Card
                    className={`p-3 ${
                      isUser
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    <p className="text-base lg:text-sm whitespace-pre-wrap break-words">{message.content}</p>
                    {!isUser && !isDemo && (
                      <div className="flex justify-end mt-1 -mb-1 -mr-1">
                        <LikeButton
                          turnId={message.id}
                          initialCount={messageLikes[message.id] || 0}
                          onLike={onLikeMessage}
                        />
                      </div>
                    )}
                  </Card>
                )}
                <span className="text-[10px] text-muted-foreground/50 mt-0.5 px-1">
                  {formatMessageTime(message.timestamp)}
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {/* Streaming message */}
      {streamingContent && (
        <div className="flex justify-start relative z-10" data-testid="streaming-message">
          <Card className="bg-muted p-3 max-w-[80%] lg:max-w-xl">
            <p className="text-base lg:text-sm whitespace-pre-wrap break-words">{streamingContent}</p>
          </Card>
        </div>
      )}

      {/* Loading indicator / typing indicator between multi-messages */}
      {(isLoading && !streamingContent) || showTypingBetweenMessages ? (
        <motion.div
          className="flex justify-start relative z-10"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          data-testid="typing-indicator"
        >
          <Card className={`bg-muted p-3 ${showTypingBetweenMessages ? 'mt-1' : ''}`}>
            <div className="flex gap-1" role="status" aria-label="Companion is typing">
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
        <div className="flex justify-center my-4 relative z-10">
          <GameBoardContainer
            gameState={activeGame}
            onUserMove={onUserMove}
            onResign={onResign}
            companionName={companionName}
            isWaitingForCompanion={waitingForCompanionMove}
          />
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
