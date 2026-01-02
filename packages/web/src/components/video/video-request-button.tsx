'use client';

import { Video } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';

interface VideoRequestButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Video request button with video/camcorder icon
 * Red theme to match video aesthetic
 */
export function VideoRequestButton({ onClick, disabled }: VideoRequestButtonProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="relative group"
    >
      <Button
        asChild
        variant="outline"
        className="relative w-full justify-start gap-3 px-5 py-4 text-base border-red-700/30 bg-background/50 backdrop-blur-sm text-red-500 hover:bg-red-900/20 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
        onClick={onClick}
        disabled={disabled}
      >
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Video className="h-5 w-5" />
          <span>Request Video</span>

          {/* Subtle shine effect on hover */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full"
            whileHover={{
              translateX: ["100%", "-100%"],
              transition: { duration: 0.8, ease: "easeInOut" }
            }}
          />
        </motion.button>
      </Button>
    </motion.div>
  );
}
