'use client';

/**
 * Companion Join Notification Component
 * Displays a notification when a companion joins or leaves the chat.
 */

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserPlus, UserMinus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GroupParticipant } from '@/lib/ws/client';

interface CompanionJoinNotificationProps {
  type: 'joined' | 'left';
  companion: {
    companionId: string;
    companionName: string;
    avatarUrl: string | null;
    themeColor: string;
  };
  reason?: string;
  invitedByName?: string;
  timestamp?: Date;
  className?: string;
}

export function CompanionJoinNotification({
  type,
  companion,
  reason,
  invitedByName,
  timestamp,
  className,
}: CompanionJoinNotificationProps) {
  const Icon = type === 'joined' ? UserPlus : UserMinus;

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 py-2 px-4',
        className
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm',
          type === 'joined'
            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
            : 'bg-muted text-muted-foreground'
        )}
      >
        <Avatar className="h-5 w-5">
          <AvatarImage
            src={companion.avatarUrl || undefined}
            alt={companion.companionName}
          />
          <AvatarFallback
            style={{ backgroundColor: companion.themeColor }}
            className="text-white text-[10px]"
          >
            {companion.companionName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <Icon className="h-3.5 w-3.5" />

        <span>
          <span className="font-medium">{companion.companionName}</span>
          {type === 'joined' ? ' joined the conversation' : ' left the conversation'}
        </span>

        {invitedByName && type === 'joined' && (
          <span className="text-muted-foreground">
            (invited by {invitedByName})
          </span>
        )}

        {reason && type === 'joined' && (
          <span className="text-muted-foreground italic">
            &mdash; {reason}
          </span>
        )}

        {timestamp && (
          <span className="text-muted-foreground text-xs">
            {timestamp.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  );
}
