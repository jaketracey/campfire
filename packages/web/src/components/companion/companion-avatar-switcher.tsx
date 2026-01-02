'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface CompanionAvatarSwitcherProps {
  children: React.ReactNode;
  onSwitch: () => Promise<void>;
  isGenerating: boolean;
  disabled?: boolean;
}

/**
 * Wrapper component that adds hover-triggered prev/next arrows around the companion avatar.
 * Desktop only - arrows are hidden on mobile.
 */
export function CompanionAvatarSwitcher({
  children,
  onSwitch,
  isGenerating,
  disabled = false,
}: CompanionAvatarSwitcherProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleSwitch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || isGenerating) return;
    await onSwitch();
  };

  return (
    <motion.div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}

      {/* Navigation arrows - desktop only */}
      <AnimatePresence>
        {isHovered && !isGenerating && !disabled && (
          <>
            {/* Left arrow */}
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2 }}
              whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.3)' }}
              whileTap={{ scale: 0.95 }}
              onClick={handleSwitch}
              className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 z-10 items-center justify-center w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm text-white shadow-lg hover:shadow-xl transition-shadow"
              aria-label="Generate new companion"
            >
              <ChevronLeft className="w-6 h-6" />
            </motion.button>

            {/* Right arrow */}
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2 }}
              whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.3)' }}
              whileTap={{ scale: 0.95 }}
              onClick={handleSwitch}
              className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 z-10 items-center justify-center w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm text-white shadow-lg hover:shadow-xl transition-shadow"
              aria-label="Generate new companion"
            >
              <ChevronRight className="w-6 h-6" />
            </motion.button>
          </>
        )}
      </AnimatePresence>

      {/* Loading overlay */}
      <AnimatePresence>
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-xl"
          >
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
              <span className="text-sm text-white/80">Generating...</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
