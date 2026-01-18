'use client';

import { Video } from 'lucide-react';
import { motion } from 'framer-motion';

interface VideoRequestButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Round video request button with video icon
 * Circular icon-only design with red theme
 */
export function VideoRequestButton({ onClick, disabled }: VideoRequestButtonProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut", delay: 0.1 }}
      className="relative group"
    >
      {/* Animated glow background */}
      <motion.div
        className="absolute -inset-1 bg-gradient-to-r from-red-500 to-rose-500 rounded-full blur opacity-30 group-hover:opacity-50 transition duration-300"
        animate={{
          scale: [1, 1.1, 1],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.5,
        }}
      />

      <motion.button
        onClick={onClick}
        disabled={disabled}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        className="relative w-14 h-14 rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/30 hover:shadow-red-500/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-shadow duration-300"
      >
        <Video className="h-6 w-6" />
      </motion.button>
    </motion.div>
  );
}
