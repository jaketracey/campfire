'use client';

import { useState, useCallback } from 'react';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface LikeButtonProps {
  turnId: string;
  initialCount?: number;
  onLike?: (turnId: string, newCount: number) => void;
  disabled?: boolean;
  className?: string;
}

export function LikeButton({
  turnId,
  initialCount = 0,
  onLike,
  disabled = false,
  className,
}: LikeButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleClick = useCallback(() => {
    if (disabled) return;

    // Optimistic update
    const newCount = count + 1;
    setCount(newCount);
    setIsAnimating(true);

    // Notify parent
    onLike?.(turnId, newCount);

    // Animation cleanup
    setTimeout(() => setIsAnimating(false), 600);
  }, [count, disabled, onLike, turnId]);

  // Sync with external count updates
  const updateCount = useCallback((newCount: number) => {
    setCount(newCount);
  }, []);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        'h-7 px-2 gap-1 text-muted-foreground hover:text-red-500 transition-all duration-200',
        isAnimating && 'scale-110',
        className
      )}
    >
      <Heart
        className={cn(
          'h-4 w-4 transition-all duration-200',
          isAnimating && 'fill-red-500 text-red-500 scale-125',
          count > 0 && 'text-red-400'
        )}
      />
      {count > 0 && (
        <span
          className={cn(
            'text-xs font-medium transition-colors',
            count > 0 && 'text-red-400'
          )}
        >
          {count}
        </span>
      )}
    </Button>
  );
}

// Export updateCount ref type for external updates
export type LikeButtonHandle = {
  updateCount: (count: number) => void;
};
