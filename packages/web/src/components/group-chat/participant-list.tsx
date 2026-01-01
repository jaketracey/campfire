'use client';

/**
 * Participant List Component
 * Displays a horizontal list of group chat participants with avatars.
 */

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { GroupParticipant } from '@/lib/ws/client';

interface ParticipantListProps {
  participants: GroupParticipant[];
  hostCompanionId: string;
  className?: string;
}

export function ParticipantList({
  participants,
  hostCompanionId,
  className,
}: ParticipantListProps) {
  if (participants.length <= 1) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className={cn('flex items-center gap-1', className)}>
        <span className="text-xs text-muted-foreground mr-1">Chat with:</span>
        <div className="flex -space-x-2">
          {participants.map((participant) => (
            <Tooltip key={participant.companionId}>
              <TooltipTrigger asChild>
                <div
                  className="relative"
                  style={{
                    zIndex: participants.indexOf(participant),
                  }}
                >
                  <Avatar
                    className={cn(
                      'h-7 w-7 border-2 transition-transform hover:scale-110 hover:z-10',
                      participant.companionId === hostCompanionId
                        ? 'border-primary'
                        : 'border-background'
                    )}
                    style={{
                      borderColor:
                        participant.companionId === hostCompanionId
                          ? participant.themeColor
                          : undefined,
                    }}
                  >
                    <AvatarImage
                      src={participant.avatarUrl || undefined}
                      alt={participant.companionName}
                    />
                    <AvatarFallback
                      style={{ backgroundColor: participant.themeColor }}
                      className="text-white text-xs"
                    >
                      {participant.companionName.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {participant.companionId === hostCompanionId && (
                    <div
                      className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background"
                      style={{ backgroundColor: participant.themeColor }}
                      title="Host"
                    />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-sm font-medium">{participant.companionName}</p>
                <p className="text-xs text-muted-foreground">
                  {participant.companionId === hostCompanionId ? 'Host' : 'Guest'}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
