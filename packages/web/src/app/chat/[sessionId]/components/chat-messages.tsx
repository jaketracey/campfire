'use client';

import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { LikeButton } from '@/components/likes';
import { GameBoardContainer } from '@/components/games';
import type { ActiveGame } from '@campfire/shared';
import type { Message } from '../types';
import { parseMessageSegments } from '../utils';
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
}: ChatMessagesProps) {
  return (
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
        // Handle gift messages specially
        if (message.giftData) {
          return (
            <GiftMessage
              key={message.id}
              giftData={message.giftData}
              isNew={message.isNew}
            />
          );
        }

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
                onLike={onLikeMessage}
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
                      onLike={onLikeMessage}
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
