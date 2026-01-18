'use client';

import { Phone } from 'lucide-react';
import { motion } from 'framer-motion';

interface CallButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Round green call button for initiating voice calls
 * Circular icon-only design with emerald theme
 */
export function CallButton({ onClick, disabled }: CallButtonProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="relative group"
    >
      {/* Animated glow background */}
      <motion.div
        className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full blur opacity-30 group-hover:opacity-50 transition duration-300"
        animate={{
          scale: [1, 1.1, 1],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <motion.button
        onClick={onClick}
        disabled={disabled}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        className="relative w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-shadow duration-300"
      >
        <motion.div
          animate={{
            rotate: [0, -5, 5, -5, 5, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            repeatDelay: 3
          }}
        >
          <Phone className="h-6 w-6" />
        </motion.div>
      </motion.button>
    </motion.div>
  );
}
