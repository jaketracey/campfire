'use client';

import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, Coins, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface InsufficientTokensModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: number;
}

/**
 * Modal shown when user tries to start a voice call without sufficient tokens.
 * Displays current balance and link to purchase more tokens.
 */
export function InsufficientTokensModal({
  isOpen,
  onClose,
  currentBalance,
}: InsufficientTokensModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-0 bg-transparent border-none shadow-none overflow-visible">
        <DialogTitle className="sr-only">Insufficient Tokens for Voice Call</DialogTitle>

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
                <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <Phone className="h-6 w-6 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-foreground">
                    Need More Tokens
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Voice calls require tokens
                  </p>
                </div>
              </div>

              {/* Content */}
              <div className="px-6 py-5">
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-3 mb-3">
                    <Coins className="h-5 w-5 text-amber-400" />
                    <span className="text-sm font-medium text-amber-400">
                      Your balance: {currentBalance} token{currentBalance !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="text-sm text-amber-300/80">
                    Voice calls cost 1 token per second. Purchase tokens to start calling.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Link href="/account/tokens" onClick={onClose}>
                  <Button className="gap-2 bg-amber-600 hover:bg-amber-500 text-white">
                    <Sparkles className="h-4 w-4" />
                    Buy Tokens
                  </Button>
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
