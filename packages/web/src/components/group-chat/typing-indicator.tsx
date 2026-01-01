'use client';

/**
 * Typing Indicator Component
 * Shows which companion(s) are currently typing/responding.
 */

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface TypingCompanion {
  companionId: string;
  companionName: string;
  avatarUrl: string | null;
  themeColor: string;
}

interface TypingIndicatorProps {
  typingCompanions: TypingCompanion[];
  className?: string;
}

export function TypingIndicator({
  typingCompanions,
  className,
}: TypingIndicatorProps) {
  if (typingCompanions.length === 0) {
    return null;
  }

  const getTypingText = () => {
    if (typingCompanions.length === 1) {
      return `${typingCompanions[0].companionName} is typing`;
    }
    if (typingCompanions.length === 2) {
      return `${typingCompanions[0].companionName} and ${typingCompanions[1].companionName} are typing`;
    }
    return `${typingCompanions.length} companions are typing`;
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-sm text-muted-foreground',
        className
      )}
    >
      <div className="flex -space-x-1">
        {typingCompanions.slice(0, 3).map((companion) => (
          <Avatar
            key={companion.companionId}
            className="h-5 w-5 border border-background"
          >
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
        ))}
      </div>

      <span>{getTypingText()}</span>

      <span className="flex gap-0.5">
        <span
          className="h-1.5 w-1.5 rounded-full bg-current animate-bounce"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-current animate-bounce"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-current animate-bounce"
          style={{ animationDelay: '300ms' }}
        />
      </span>
    </div>
  );
}
