'use client';

import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Coins, Loader2 } from 'lucide-react';
import type { Gift } from '@/lib/api/gifts';

export type GiftCardSize = 'sm' | 'md' | 'lg';

interface GiftCardProps {
  gift: Gift;
  onSelect?: (gift: Gift) => void;
  selected?: boolean;
  disabled?: boolean;
  size?: GiftCardSize;
  className?: string;
}

const sizeClasses: Record<GiftCardSize, { card: string; image: string; text: string }> = {
  sm: {
    card: 'p-2',
    image: 'w-12 h-12',
    text: 'text-xs',
  },
  md: {
    card: 'p-3',
    image: 'w-16 h-16',
    text: 'text-sm',
  },
  lg: {
    card: 'p-4',
    image: 'w-24 h-24',
    text: 'text-base',
  },
};

export function GiftCard({
  gift,
  onSelect,
  selected = false,
  disabled = false,
  size = 'md',
  className,
}: GiftCardProps) {
  const sizes = sizeClasses[size];
  const isGenerating = gift.status === 'generating';
  const isClickable = onSelect && !disabled && !isGenerating;

  return (
    <Card
      className={cn(
        'relative transition-all duration-200',
        sizes.card,
        isClickable && 'cursor-pointer hover:shadow-md hover:border-primary/50',
        selected && 'ring-2 ring-primary border-primary',
        disabled && 'opacity-50 cursor-not-allowed',
        isGenerating && 'animate-pulse',
        className
      )}
      onClick={() => isClickable && onSelect(gift)}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(gift);
        }
      }}
    >
      <div className="flex items-start gap-3">
        {/* Gift Image */}
        <div
          className={cn(
            'relative rounded-lg overflow-hidden bg-muted flex items-center justify-center shrink-0',
            sizes.image
          )}
        >
          {isGenerating ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : gift.imageUrl ? (
            <img
              src={gift.imageUrl}
              alt={gift.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-campfire-400 to-campfire-600 flex items-center justify-center">
              <span className="text-2xl">🎁</span>
            </div>
          )}
        </div>

        {/* Gift Details */}
        <div className="flex-1 min-w-0">
          <h4 className={cn('font-semibold truncate', sizes.text)}>
            {isGenerating ? 'Generating...' : gift.name}
          </h4>
          <p
            className={cn(
              'text-muted-foreground line-clamp-2 mt-0.5',
              size === 'sm' ? 'text-[10px]' : 'text-xs'
            )}
          >
            {isGenerating ? 'Creating a special gift...' : gift.description}
          </p>
          {gift.emotionalMeaning && !isGenerating && (
            <p
              className={cn(
                'text-muted-foreground/80 italic mt-1 line-clamp-1',
                size === 'sm' ? 'text-[10px]' : 'text-xs'
              )}
            >
              {gift.emotionalMeaning}
            </p>
          )}
        </div>

        {/* Token Cost Badge */}
        <div
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 shrink-0',
            size === 'sm' ? 'text-[10px]' : 'text-xs'
          )}
        >
          <Coins className={cn(size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
          <span className="font-medium">{gift.tokenCost}</span>
        </div>
      </div>

      {/* Given indicator */}
      {gift.status === 'given' && gift.givenAt && (
        <div className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
          Given
        </div>
      )}
    </Card>
  );
}
