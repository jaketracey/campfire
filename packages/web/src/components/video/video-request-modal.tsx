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
import { Textarea } from '@/components/ui/textarea';
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
              <div className="flex items-center gap-4 px-6 py-5 border-b border-white/5">
                {avatarUrl && (
                  <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-red-500/30">
                    <img
                      src={avatarUrl}
                      alt={companionName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-foreground truncate">
                    Request Video from {companionName}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Ask for a short video message
                  </p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20">
                  <Coins className="h-4 w-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">{TOKEN_COST}</span>
                </div>
              </div>

              {/* Content */}
              <div className="px-6 py-5 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    What would you like {companionName} to do?
                  </label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={`e.g., "Send me a good morning message with a smile" or "Wave and say hello"`}
                    className="min-h-[100px] resize-none bg-white/5 border-white/10 focus:border-red-500/50"
                    maxLength={500}
                    disabled={isSubmitting}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Minimum 10 characters</span>
                    <span>{prompt.length}/500</span>
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                    {error}
                  </div>
                )}

                {!canAfford && (
                  <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-sm text-amber-400 mb-4">
                      Insufficient tokens. You need {TOKEN_COST} tokens but have {tokenBalance ?? 0}.
                    </p>
                    <Link href="/account/tokens" onClick={handleClose}>
                      <Button
                        size="sm"
                        className="gap-2 bg-amber-600 hover:bg-amber-500 text-white"
                      >
                        <Sparkles className="h-4 w-4" />
                        Buy Tokens
                      </Button>
                    </Link>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3">
                <Button
                  variant="ghost"
                  onClick={handleClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!isValid || !canAfford || isSubmitting}
                  className="bg-red-600 hover:bg-red-500 text-white"
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
