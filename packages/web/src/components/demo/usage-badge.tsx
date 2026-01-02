'use client';

/**
 * Usage Badge Component
 * Displays the remaining message count for demo/anonymous sessions.
 */

import { motion } from 'framer-motion';
import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UsageBadgeProps {
  messagesUsed: number;
  messageLimit: number;
  className?: string;
}

export function UsageBadge({
  messagesUsed,
  messageLimit,
  className,
}: UsageBadgeProps) {
  const remaining = Math.max(0, messageLimit - messagesUsed);
  const isLow = remaining <= 3;
  const isEmpty = remaining === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
        isEmpty
          ? 'bg-destructive/10 text-destructive'
          : isLow
            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
            : 'bg-primary/10 text-primary',
        className
      )}
    >
      <MessageSquare className="h-3.5 w-3.5" />
      <span>
        {isEmpty ? (
          'No messages remaining'
        ) : (
          <>
            <span className="font-semibold">{remaining}</span>
            {' '}message{remaining !== 1 ? 's' : ''} remaining
          </>
        )}
      </span>
      {isLow && !isEmpty && (
        <motion.span
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="ml-0.5"
        >
          !
        </motion.span>
      )}
    </motion.div>
  );
}
