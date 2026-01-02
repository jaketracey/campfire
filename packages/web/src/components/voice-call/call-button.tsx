'use client';

import { Phone } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';

interface CallButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Green call button for initiating voice calls
 * Styled to match the sidebar button pattern (emerald theme)
 */
export function CallButton({ onClick, disabled }: CallButtonProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="relative group"
    >
      {/* Animated glow background */}
      <motion.div
        className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"
        animate={{
          scale: [1, 1.02, 1],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <Button
        asChild
        variant="outline"
        className="relative w-full justify-start gap-3 px-5 py-4 text-base border-emerald-700/30 bg-background/50 backdrop-blur-sm text-emerald-500 hover:bg-emerald-900/20 hover:text-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
        onClick={onClick}
        disabled={disabled}
      >
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
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
            <Phone className="h-5 w-5" />
          </motion.div>
          Call

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
