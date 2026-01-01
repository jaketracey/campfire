'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

interface BackstoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  companionName: string;
  backstory: string;
  archetype?: string;
  avatarUrl?: string;
}

/**
 * Backstory reveal modal with typewriter text animation
 */
export function BackstoryModal({
  isOpen,
  onClose,
  companionName,
  backstory,
  archetype,
  avatarUrl,
}: BackstoryModalProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showSkip, setShowSkip] = useState(false);

  // Typewriter effect
  useEffect(() => {
    if (!isOpen || !backstory) {
      setDisplayedText('');
      setIsTyping(false);
      return;
    }

    setIsTyping(true);
    setShowSkip(false);
    let currentIndex = 0;
    const text = backstory;

    // Show skip button after a short delay
    const skipTimer = setTimeout(() => setShowSkip(true), 1000);

    const typeInterval = setInterval(() => {
      if (currentIndex < text.length) {
        // Type 2-3 characters at a time for faster reveal
        const charsToAdd = Math.min(2, text.length - currentIndex);
        setDisplayedText(text.slice(0, currentIndex + charsToAdd));
        currentIndex += charsToAdd;
      } else {
        clearInterval(typeInterval);
        setIsTyping(false);
      }
    }, 25); // Speed of typing

    return () => {
      clearInterval(typeInterval);
      clearTimeout(skipTimer);
    };
  }, [isOpen, backstory]);

  const handleSkip = useCallback(() => {
    setDisplayedText(backstory);
    setIsTyping(false);
  }, [backstory]);

  const handleClose = useCallback(() => {
    setDisplayedText('');
    setIsTyping(false);
    onClose();
  }, [onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="max-w-2xl p-0 bg-transparent border-none shadow-none overflow-visible"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{companionName}&apos;s Backstory</DialogTitle>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative bg-zinc-900 rounded-xl border border-zinc-700/50 overflow-hidden shadow-xl"
            >
              {/* Header */}
              <div className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800">
                {avatarUrl && (
                  <div className="w-12 h-12 rounded-full overflow-hidden border border-zinc-700">
                    <img
                      src={avatarUrl}
                      alt={companionName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-zinc-100 truncate">
                    {companionName}
                  </h2>
                  {archetype && (
                    <p className="text-sm text-zinc-500">
                      {archetype}
                    </p>
                  )}
                </div>
              </div>

              {/* Backstory content */}
              <div className="px-6 py-5 min-h-[200px] max-h-[60vh] overflow-y-auto">
                <p className="text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {displayedText}
                  {isTyping && (
                    <motion.span
                      animate={{ opacity: [1, 0] }}
                      transition={{ duration: 0.5, repeat: Infinity }}
                      className="inline-block w-0.5 h-4 bg-zinc-400 ml-0.5 align-middle"
                    />
                  )}
                </p>
              </div>

              {/* Footer with skip button */}
              {isTyping && showSkip && (
                <div className="px-6 py-3 border-t border-zinc-800 flex justify-end">
                  <button
                    onClick={handleSkip}
                    className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Skip
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
