'use client';

/**
 * Typing Indicator Component
 * Shows which companion(s) are currently typing/responding.
 */

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

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
    <AnimatePresence mode="wait">
      {typingCompanions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 5, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className={cn(
            'flex items-center gap-2 text-sm text-muted-foreground py-1',
            className
          )}
        >
          <div className="flex -space-x-1.5">
            <AnimatePresence>
              {typingCompanions.slice(0, 3).map((companion) => (
                <motion.div
                  key={companion.companionId}
                  initial={{ opacity: 0, scale: 0.5, x: -10 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.5, x: -10 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                >
                  <Avatar className="h-5 w-5 border-2 border-background shadow-sm">
                    <AvatarImage
                      src={companion.avatarUrl || undefined}
                      alt={companion.companionName}
                    />
                    <AvatarFallback
                      style={{ backgroundColor: companion.themeColor }}
                      className="text-white text-[8px] font-bold"
                    >
                      {companion.companionName.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <motion.span
            layout
            className="font-medium"
          >
            {getTypingText()}
          </motion.span>

          <span className="flex gap-1 ml-0.5">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                animate={{
                  y: [0, -3, 0],
                  opacity: [0.4, 1, 0.4],
                }}
                transition={{
                  duration: 0.6,
                  repeat: Infinity,
                  delay: i * 0.15,
                  ease: "easeInOut",
                }}
                className="h-1.5 w-1.5 rounded-full bg-campfire-400 dark:bg-campfire-500 shadow-[0_0_8px_rgba(249,115,22,0.3)]"
              />
            ))}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
