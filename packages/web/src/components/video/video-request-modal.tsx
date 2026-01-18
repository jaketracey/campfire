'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Video, Coins, Loader2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { requestVideo } from '@/lib/api/videos';

interface VideoRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  companionId: string;
  companionName: string;
  sessionId?: string;
  avatarUrl?: string;
  tokenBalance: number;
  onSuccess?: (videoRequestId: string, newBalance: number) => void;
}

const TOKEN_COST = 100;

/**
 * Video request modal with prompt input
 * Styled to match BackstoryModal
 */
export function VideoRequestModal({
  isOpen,
  onClose,
  companionId,
  companionName,
  sessionId,
  avatarUrl,
  tokenBalance,
  onSuccess,
}: VideoRequestModalProps) {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAfford = tokenBalance >= TOKEN_COST;
  const isValid = prompt.trim().length >= 10;

  const handleSubmit = useCallback(async () => {
    if (!isValid || !canAfford || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await requestVideo({
        companionId,
        prompt: prompt.trim(),
        sessionId,
      });

      onSuccess?.(result.videoRequestId, result.newBalance);
      setPrompt('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request video');
    } finally {
      setIsSubmitting(false);
    }
  }, [companionId, prompt, sessionId, isValid, canAfford, isSubmitting, onSuccess, onClose]);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    setPrompt('');
    setError(null);
    onClose();
  }, [isSubmitting, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="max-w-lg p-0 bg-transparent border-none shadow-none overflow-visible"
        onPointerDownOutside={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Request Video from {companionName}</DialogTitle>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative bg-gradient-to-b from-background to-muted/30 rounded-3xl overflow-hidden shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center gap-4 px-6 pt-6 pb-5">
                {avatarUrl && (
                  <div className="w-14 h-14 rounded-full overflow-hidden ring-2 ring-red-500/30 shadow-lg">
                    <img
                      src={avatarUrl}
                      alt={companionName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold text-foreground truncate">
                    Request Video from {companionName}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Ask for a short personalized video message
                  </p>
                </div>
              </div>

              {/* Token cost badge */}
              <div className="px-6 pb-4">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20">
                  <Coins className="h-4 w-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">{TOKEN_COST} tokens</span>
                </div>
              </div>

              {/* Content */}
              <div className="px-6 pb-6 space-y-5">
                <div className="space-y-3">
                  <label className="text-sm font-medium text-muted-foreground">
                    Describe your video request
                  </label>
                  <div className="relative">
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={`"Send me a sweet good morning message" or "Blow me a kiss and wink"...`}
                      className="w-full min-h-[120px] px-4 py-3 text-base resize-none rounded-xl border border-white/10 bg-white/5 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-[3px] focus:ring-red-500/20 focus:border-red-500/50 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
                      maxLength={500}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className={`${prompt.length >= 10 ? 'text-muted-foreground' : 'text-muted-foreground/60'}`}>
                      {prompt.length < 10 ? `${10 - prompt.length} more characters needed` : 'Ready to submit'}
                    </span>
                    <span className="text-muted-foreground tabular-nums">{prompt.length}/500</span>
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                    {error}
                  </div>
                )}

                {!canAfford && (
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <p className="text-sm text-amber-400 mb-4">
                      You need {TOKEN_COST} tokens but only have {tokenBalance ?? 0}.
                    </p>
                    <Link href="/account/tokens" onClick={handleClose}>
                      <Button
                        size="sm"
                        className="gap-2 bg-amber-600 hover:bg-amber-500 text-white"
                      >
                        <Sparkles className="h-4 w-4" />
                        Get More Tokens
                      </Button>
                    </Link>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3 bg-black/20">
                <Button
                  variant="ghost"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="hover:bg-white/5"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!isValid || !canAfford || isSubmitting}
                  className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white shadow-lg shadow-red-500/20 hover:shadow-red-500/30 transition-all duration-200"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Requesting...
                    </>
                  ) : (
                    <>
                      <Video className="h-4 w-4 mr-2" />
                      Request Video
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
