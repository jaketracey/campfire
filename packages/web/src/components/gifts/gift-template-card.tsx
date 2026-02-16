'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Coins, Flame, TrendingUp } from 'lucide-react';
import type { GiftTemplate } from '@/lib/api/gifts';

interface GiftTemplateCardProps {
  template: GiftTemplate;
  onSelect?: (template: GiftTemplate) => void;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
}

export function GiftTemplateCard({
  template,
  onSelect,
  selected = false,
  disabled = false,
  className,
}: GiftTemplateCardProps) {
  const isClickable = onSelect && !disabled;
  const isTrending = template.sendsLast7Days > 5;
  const isPopular = template.totalSends > 20;

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-all duration-200 group',
        isClickable && 'cursor-pointer hover:shadow-md hover:border-primary/50',
        selected && 'ring-2 ring-primary border-primary',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      onClick={() => isClickable && onSelect(template)}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(template);
        }
      }}
    >
      {/* Image */}
      <div className="aspect-square relative overflow-hidden bg-muted">
        <Image
          src={template.imageUrl}
          alt={template.name}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />

        {/* Popularity indicators */}
        {(isTrending || isPopular) && (
          <div className="absolute top-2 left-2 flex gap-1">
            {isTrending && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-orange-500/90 text-white text-[10px] font-medium">
                <TrendingUp className="h-3 w-3" />
                <span>Trending</span>
              </div>
            )}
            {isPopular && !isTrending && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-campfire-500/90 text-white text-[10px] font-medium">
                <Flame className="h-3 w-3" />
                <span>Popular</span>
              </div>
            )}
          </div>
        )}

        {/* Token cost badge */}
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 text-white text-xs backdrop-blur-sm">
          <Coins className="h-3 w-3" />
          <span className="font-medium">{template.tokenCost}</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        <h4 className="font-semibold text-sm truncate">{template.name}</h4>
        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
          {template.description || template.emotionalMeaning}
        </p>
      </div>

      {/* Selection indicator */}
      {selected && (
        <div className="absolute inset-0 bg-primary/10 pointer-events-none" />
      )}
    </Card>
  );
}
