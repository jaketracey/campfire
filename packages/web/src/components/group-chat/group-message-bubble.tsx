'use client';

/**
 * Group Message Bubble Component
 * Displays a message from a specific companion with their name, avatar, and theme color.
 */

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { GroupParticipant } from '@/lib/ws/client';

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
    <div
      className={cn(
        'flex gap-3',
        isReaction && 'ml-8 opacity-90',
        className
      )}
    >
      <Avatar
        className="h-8 w-8 shrink-0"
        style={{
          borderColor: companion.themeColor,
          borderWidth: '2px',
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
          <span
            className="font-medium text-sm"
            style={{ color: companion.themeColor }}
          >
            {companion.companionName}
          </span>
          {isReaction && (
            <span className="text-xs text-muted-foreground italic">
              reacts
            </span>
          )}
          {timestamp && (
            <span className="text-xs text-muted-foreground">
              {timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>

        <div
          className={cn(
            'rounded-lg px-3 py-2 text-sm',
            isReaction
              ? 'bg-muted/50 text-muted-foreground italic'
              : 'bg-muted text-foreground'
          )}
          style={{
            borderLeft: `3px solid ${companion.themeColor}`,
          }}
        >
          <p className="whitespace-pre-wrap break-words">
            {content}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse" />
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
