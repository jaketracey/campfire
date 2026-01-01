'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Scroll, Sparkles } from 'lucide-react';
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
 * Oblivion-style backstory reveal modal
 * Features typewriter text animation and atmospheric styling
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
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="relative"
            >
              {/* Outer glow effect */}
              <div className="absolute -inset-4 bg-gradient-to-b from-amber-500/20 via-orange-500/10 to-amber-900/20 rounded-3xl blur-2xl pointer-events-none" />

              {/* Main scroll container */}
              <div className="relative bg-gradient-to-b from-[#1a1510] via-[#151210] to-[#0d0b09] rounded-2xl border border-amber-900/30 overflow-hidden shadow-[0_0_60px_rgba(180,120,60,0.15)]">

                {/* Decorative top border */}
                <div className="h-1 bg-gradient-to-r from-transparent via-amber-600/50 to-transparent" />

                {/* Header with companion info */}
                <div className="relative px-8 pt-6 pb-4 border-b border-amber-900/20">
                  <div className="absolute inset-0 bg-gradient-to-b from-amber-900/10 to-transparent pointer-events-none" />

                  <div className="relative flex items-center gap-4">
                    {/* Avatar */}
                    {avatarUrl && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.2 }}
                        className="relative"
                      >
                        <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-amber-600/40 shadow-[0_0_20px_rgba(180,120,60,0.3)]">
                          <img
                            src={avatarUrl}
                            alt={companionName}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-900/80 border border-amber-600/50 flex items-center justify-center">
                          <Scroll className="w-3 h-3 text-amber-400" />
                        </div>
                      </motion.div>
                    )}

                    <div className="flex-1">
                      <motion.h2
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 }}
                        className="text-2xl font-bold text-amber-100 font-display tracking-wide"
                      >
                        {companionName}
                      </motion.h2>
                      {archetype && (
                        <motion.p
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.4 }}
                          className="text-sm text-amber-500/70 font-medium tracking-widest uppercase mt-1"
                        >
                          {archetype}
                        </motion.p>
                      )}
                    </div>

                    {/* Close button */}
                    <button
                      onClick={handleClose}
                      className="p-2 rounded-full bg-amber-900/30 hover:bg-amber-900/50 border border-amber-700/30 text-amber-400/70 hover:text-amber-300 transition-all"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Decorative flourish */}
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ delay: 0.5, duration: 0.6 }}
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 w-32 h-px bg-gradient-to-r from-transparent via-amber-600/50 to-transparent"
                  />
                </div>

                {/* Backstory content */}
                <div className="relative px-8 py-6 min-h-[300px] max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-amber-900/50 scrollbar-track-transparent">
                  {/* Parchment texture overlay */}
                  <div className="absolute inset-0 opacity-5 pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48ZmlsdGVyIGlkPSJub2lzZSI+PGZlVHVyYnVsZW5jZSBiYXNlRnJlcXVlbmN5PSIwLjgiIG51bU9jdGF2ZXM9IjQiIHN0aXRjaFRpbGVzPSJzdGl0Y2giLz48L2ZpbHRlcj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWx0ZXI9InVybCgjbm9pc2UpIi8+PC9zdmc+')]" />

                  {/* Quote mark decoration */}
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 0.15, y: 0 }}
                    transition={{ delay: 0.6 }}
                    className="absolute top-4 left-4 text-6xl text-amber-500 font-serif leading-none pointer-events-none select-none"
                  >
                    "
                  </motion.div>

                  {/* The backstory text with typewriter effect */}
                  <div className="relative pl-8 pr-4">
                    <p className="text-amber-100/90 text-lg leading-relaxed font-serif whitespace-pre-wrap">
                      {displayedText}
                      {isTyping && (
                        <motion.span
                          animate={{ opacity: [1, 0] }}
                          transition={{ duration: 0.5, repeat: Infinity }}
                          className="inline-block w-0.5 h-5 bg-amber-400 ml-0.5 align-middle"
                        />
                      )}
                    </p>

                    {/* Fade gradient at bottom while typing */}
                    {isTyping && (
                      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#151210] to-transparent pointer-events-none" />
                    )}
                  </div>

                  {/* Closing quote */}
                  <AnimatePresence>
                    {!isTyping && displayedText.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 0.15, y: 0 }}
                        className="absolute bottom-4 right-8 text-6xl text-amber-500 font-serif leading-none pointer-events-none select-none"
                      >
                        "
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Footer */}
                <div className="relative px-8 py-4 border-t border-amber-900/20">
                  <div className="flex items-center justify-between">
                    {/* Sparkle decoration */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.8 }}
                      className="flex items-center gap-2 text-amber-600/50"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span className="text-xs font-medium tracking-wider uppercase">
                        Origin Story
                      </span>
                    </motion.div>

                    {/* Skip button */}
                    <AnimatePresence>
                      {isTyping && showSkip && (
                        <motion.button
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          onClick={handleSkip}
                          className="px-4 py-1.5 text-sm font-medium text-amber-400/70 hover:text-amber-300 border border-amber-700/30 hover:border-amber-600/50 rounded-full bg-amber-900/20 hover:bg-amber-900/30 transition-all"
                        >
                          Skip Animation
                        </motion.button>
                      )}
                    </AnimatePresence>

                    {/* Done indicator */}
                    <AnimatePresence>
                      {!isTyping && displayedText.length > 0 && (
                        <motion.button
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          onClick={handleClose}
                          className="px-6 py-2 text-sm font-bold text-amber-900 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 rounded-full shadow-[0_0_20px_rgba(180,120,60,0.3)] transition-all hover:scale-105"
                        >
                          Close Tome
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Decorative bottom border */}
                <div className="h-1 bg-gradient-to-r from-transparent via-amber-600/50 to-transparent" />
              </div>

              {/* Corner decorations */}
              <div className="absolute -top-2 -left-2 w-8 h-8 border-l-2 border-t-2 border-amber-600/30 rounded-tl-lg pointer-events-none" />
              <div className="absolute -top-2 -right-2 w-8 h-8 border-r-2 border-t-2 border-amber-600/30 rounded-tr-lg pointer-events-none" />
              <div className="absolute -bottom-2 -left-2 w-8 h-8 border-l-2 border-b-2 border-amber-600/30 rounded-bl-lg pointer-events-none" />
              <div className="absolute -bottom-2 -right-2 w-8 h-8 border-r-2 border-b-2 border-amber-600/30 rounded-br-lg pointer-events-none" />
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
