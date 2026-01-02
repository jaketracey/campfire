'use client';

/**
 * Group Message Bubble Component
 * Displays a message from a specific companion with their name, avatar, and theme color.
 */

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { GroupParticipant } from '@/lib/ws/client';
import { motion } from 'framer-motion';

interface GroupMessageBubbleProps {
  content: string;
  companion: GroupParticipant;
  isReaction?: boolean;
  isStreaming?: boolean;
  timestamp?: Date;
  className?: string;
}

export function GroupMessageBubble({
  content,
  companion,
  isReaction = false,
  isStreaming = false,
  timestamp,
  className,
}: GroupMessageBubbleProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{
        type: 'spring',
        stiffness: 260,
        damping: 20,
      }}
      whileHover={{ scale: 1.005 }}
      className={cn(
        'flex gap-3 group transition-opacity duration-200',
        isReaction && 'ml-8 opacity-90',
        className
      )}
    >
      <Avatar
        className="h-8 w-8 shrink-0 ring-offset-background transition-all group-hover:ring-2"
        style={{
          borderColor: companion.themeColor,
          borderWidth: '2px',
          boxShadow: `0 0 10px ${companion.themeColor}33`,
        }}
      >
        <AvatarImage
          src={companion.avatarUrl || undefined}
          alt={companion.companionName}
        />
        <AvatarFallback
          style={{ backgroundColor: companion.themeColor }}
          className="text-white text-xs"
        >
          {companion.companionName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="font-medium text-sm"
            style={{ color: companion.themeColor }}
          >
            {companion.companionName}
          </motion.span>
          {isReaction && (
            <span className="text-xs text-muted-foreground italic">
              reacts
            </span>
          )}
          {timestamp && (
            <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
              {timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>

        <motion.div
          layout="position"
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm shadow-sm transition-shadow group-hover:shadow-md',
            isReaction
              ? 'bg-muted/50 text-muted-foreground italic'
              : 'bg-muted text-foreground'
          )}
          style={{
            borderLeft: `4px solid ${companion.themeColor}`,
          }}
        >
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            {content}
            {isStreaming && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{
                  duration: 0.8,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="inline-block w-1.5 h-4 ml-1 align-middle rounded-full"
                style={{ backgroundColor: companion.themeColor }}
              />
            )}
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}
