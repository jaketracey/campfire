'use client';

import { Video } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface VideoCallButtonProps {
  onClick: () => void;
  disabled?: boolean;
  tokenCost?: number;
}

/**
 * Button to initiate video calls, displayed alongside the voice call button.
 * Circular icon design with a purple/violet theme.
 */
export function VideoCallButton({ onClick, disabled, tokenCost }: VideoCallButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="relative group"
          >
            {/* Animated glow background */}
            <motion.div
              className="absolute -inset-1 bg-gradient-to-r from-violet-500 to-purple-500 rounded-full blur opacity-30 group-hover:opacity-50 transition duration-300"
              animate={{
                scale: [1, 1.1, 1],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />

            <motion.button
              onClick={onClick}
              disabled={disabled}
              aria-label="Start video call"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className="relative w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/30 hover:shadow-violet-500/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-shadow duration-300"
            >
              <Video className="h-6 w-6" />
            </motion.button>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {disabled ? (
            <span>Video calls unavailable</span>
          ) : tokenCost ? (
            <span>Start video call ({tokenCost} tokens/min)</span>
          ) : (
            <span>Start video call</span>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
