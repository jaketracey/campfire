'use client';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import Image from 'next/image';
import { Coins, Loader2 } from 'lucide-react';
import type { Gift } from '@/lib/api/gifts';

interface GiftSendConfirmationProps {
  gift: Gift | null;
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isSending: boolean;
}

export function GiftSendConfirmation({
  gift,
  isOpen,
  onConfirm,
  onCancel,
  isSending,
}: GiftSendConfirmationProps) {
  if (!gift) return null;

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Send Gift?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                You are about to send this gift to your companion. This action
                will consume tokens from your balance.
              </p>

              {/* Gift Preview */}
              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted">
                <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-muted-foreground/10 shrink-0">
                  {gift.imageUrl ? (
                    <Image
                      src={gift.imageUrl}
                      alt={gift.name}
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-campfire-400 to-campfire-600">
                      <span className="text-2xl">🎁</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-foreground">{gift.name}</h4>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {gift.description}
                  </p>
                </div>
              </div>

              {/* Token Cost */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Token Cost
                </span>
                <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                  <Coins className="h-4 w-4" />
                  <span className="font-bold">{gift.tokenCost}</span>
                </div>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isSending}>
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Sending...
              </>
            ) : (
              'Send Gift'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
