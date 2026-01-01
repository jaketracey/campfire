'use client';

import { cn } from '@/lib/utils';
import { Coins, Plus } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';

interface TokenBalanceDisplayProps {
  balance: number;
  showPurchaseLink?: boolean;
  compact?: boolean;
  className?: string;
}

export function TokenBalanceDisplay({
  balance,
  showPurchaseLink = false,
  compact = false,
  className,
}: TokenBalanceDisplayProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2',
        compact ? 'text-xs' : 'text-sm',
        className
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-full',
          'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        )}
      >
        <Coins className={cn(compact ? 'h-3 w-3' : 'h-4 w-4')} />
        <span className="font-semibold">{balance.toLocaleString()}</span>
      </div>

      {showPurchaseLink && (
        <Link
          href={'/account/tokens' as Route}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-full transition-colors',
            'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground',
            compact ? 'text-[10px]' : 'text-xs'
          )}
        >
          <Plus className={cn(compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
          <span>Buy More</span>
        </Link>
      )}
    </div>
  );
}
