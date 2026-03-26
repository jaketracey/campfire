'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Palette, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface CustomizePromptBannerProps {
  /** The companion's display name. */
  companionName: string;
  /** The companion's ID, used to build the customize link. */
  companionId: string;
  /** The active session ID. */
  sessionId: string;
}

/**
 * A persistent but dismissible banner shown in the chat header that
 * encourages new users to customize their companion after the quick-meet
 * onboarding flow.
 */
export function CustomizePromptBanner({
  companionName,
  companionId,
  sessionId,
}: CustomizePromptBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const storageKey = `customize-prompt-dismissed-${companionId}`;

  // Persist dismissal so it does not reappear after page reloads.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const wasDismissed = localStorage.getItem(storageKey);
      if (wasDismissed === 'true') {
        setDismissed(true);
      }
    }
  }, [storageKey]);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, 'true');
    }
  };

  if (dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex items-center justify-between gap-3 px-4 py-2 bg-white/5 border-b border-white/5 text-sm"
    >
      <Link
        href={`/companions/${companionId}/settings` as any}
        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
      >
        <Palette className="h-4 w-4 shrink-0" />
        <span>
          Customize {companionName}&apos;s appearance, voice &amp; more
        </span>
        <span className="text-gray-600">&rarr;</span>
      </Link>
      <button
        type="button"
        onClick={handleDismiss}
        className="text-gray-600 hover:text-gray-400 transition-colors shrink-0"
        aria-label="Dismiss customization prompt"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

interface CustomizePromptSlideUpProps {
  companionName: string;
  companionId: string;
  /** Whether the slide-up is visible. */
  open: boolean;
  onClose: () => void;
}

/**
 * A gentle slide-up prompt shown after the first session ends, encouraging
 * the user to customize their companion.
 */
export function CustomizePromptSlideUp({
  companionName,
  companionId,
  open,
  onClose,
}: CustomizePromptSlideUpProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90vw] max-w-md"
        >
          <div className="bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
            <div className="flex flex-col items-center text-center gap-4">
              <Palette className="h-8 w-8 text-vibes-neon" />
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-white">
                  Make {companionName} more you
                </h3>
                <p className="text-sm text-gray-400">
                  Customize their look, voice, and personality anytime.
                </p>
              </div>
              <div className="flex items-center gap-3 w-full">
                <Button
                  variant="ghost"
                  onClick={onClose}
                  className="flex-1 text-gray-400 hover:text-white"
                >
                  Maybe later
                </Button>
                <Button
                  asChild
                  className="flex-1 bg-gradient-to-r from-vibes-hot via-vibes-neon to-vibes-electric"
                >
                  <Link href={`/companions/${companionId}/settings` as any}>
                    Customize
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
