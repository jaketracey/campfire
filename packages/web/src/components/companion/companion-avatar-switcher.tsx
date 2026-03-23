'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Loader2 } from 'lucide-react';

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

      {/* Generate new look button - desktop only */}
      <AnimatePresence>
        {isHovered && !isGenerating && !disabled && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.3)' }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSwitch}
            className="hidden md:flex absolute bottom-3 right-3 z-10 items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs shadow-lg hover:shadow-xl transition-shadow"
            aria-label="Generate new look"
            title="Generate new look"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>New look</span>
          </motion.button>
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
