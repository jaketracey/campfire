'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Coins, Gift, Loader2, Check, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { GiftTemplate } from '@/lib/api/gifts';
import { getTokenBundles, type TokenBundle } from '@/lib/api/tokens';

interface GiftPurchaseModalProps {
  template: GiftTemplate | null;
  isOpen: boolean;
  tokenBalance: number;
  onSendGift: () => void;
  onCancel: () => void;
  isSending: boolean;
}

export function GiftPurchaseModal({
  template,
  isOpen,
  tokenBalance,
  onSendGift,
  onCancel,
  isSending,
}: GiftPurchaseModalProps) {
  const router = useRouter();
  const [bundles, setBundles] = useState<TokenBundle[]>([]);
  const [loadingBundles, setLoadingBundles] = useState(false);

  const canAfford = template ? tokenBalance >= template.tokenCost : false;
  const tokensNeeded = template ? Math.max(0, template.tokenCost - tokenBalance) : 0;

  // Fetch token bundles when user can't afford
  useEffect(() => {
    if (isOpen && !canAfford && bundles.length === 0) {
      fetchBundles();
    }
  }, [isOpen, canAfford]);

  const fetchBundles = async () => {
    setLoadingBundles(true);
    try {
      const data = await getTokenBundles();
      setBundles(data);
    } catch (err) {
      console.error('Failed to fetch bundles:', err);
    } finally {
      setLoadingBundles(false);
    }
  };

  const handlePurchaseTokens = () => {
    // Navigate to tokens page for purchase
    router.push('/account/tokens' as Route);
  };

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  if (!template) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop / Lightbox */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onCancel}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg"
          >
            <div className="bg-background rounded-xl shadow-2xl border overflow-hidden mx-4">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                  <Gift className="h-5 w-5 text-campfire-500" />
                  <span className="font-semibold">Send Gift</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onCancel}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Content */}
              <div className="p-5 space-y-5">
                {/* Gift Preview */}
                <div className="flex gap-4">
                  <div className="w-24 h-24 rounded-lg overflow-hidden bg-muted shrink-0">
                    <img
                      src={template.imageUrl}
                      alt={template.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg">{template.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {template.description || template.emotionalMeaning}
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 text-amber-600 dark:text-amber-400">
                      <Coins className="h-4 w-4" />
                      <span className="font-semibold">{template.tokenCost} tokens</span>
                    </div>
                  </div>
                </div>

                {/* Balance Display */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">Your balance</span>
                  <div className="flex items-center gap-1.5">
                    <Coins className="h-4 w-4 text-amber-500" />
                    <span className="font-semibold">{tokenBalance.toLocaleString()}</span>
                  </div>
                </div>

                {/* Can Afford - Show Send Button */}
                {canAfford ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300">
                      <Check className="h-4 w-4" />
                      <span className="text-sm">You have enough tokens!</span>
                    </div>
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={onCancel}
                        disabled={isSending}
                      >
                        Cancel
                      </Button>
                      <Button
                        className="flex-1 gap-2"
                        onClick={onSendGift}
                        disabled={isSending}
                      >
                        {isSending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Gift className="h-4 w-4" />
                        )}
                        {isSending ? 'Sending...' : 'Send Gift'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Not Enough Tokens - Show Purchase Options */
                  <div className="space-y-4">
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        You need <span className="font-semibold">{tokensNeeded} more tokens</span> to send this gift.
                      </p>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium mb-3">Purchase tokens</h4>
                      {loadingBundles ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <ScrollArea className="h-[200px]">
                          <div className="space-y-2 pr-2">
                            {bundles.map((bundle) => {
                              const totalTokens = bundle.tokens + bundle.bonusTokens;
                              const wouldAfford = tokenBalance + totalTokens >= template.tokenCost;

                              return (
                                <Card
                                  key={bundle.id}
                                  className={cn(
                                    'transition-all cursor-pointer hover:border-primary/50',
                                    bundle.isPopular && 'ring-1 ring-campfire-500 border-campfire-500',
                                    wouldAfford && 'bg-green-50/50 dark:bg-green-900/10'
                                  )}
                                  onClick={handlePurchaseTokens}
                                >
                                  <CardContent className="p-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                                          <Coins className="h-4 w-4" />
                                          <span className="font-semibold">
                                            {totalTokens.toLocaleString()}
                                          </span>
                                        </div>
                                        <div className="text-sm">
                                          <span className="font-medium">{bundle.name}</span>
                                          {bundle.bonusTokens > 0 && (
                                            <span className="ml-1 text-green-600 dark:text-green-400 text-xs">
                                              +{bundle.bonusTokens} bonus
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant={bundle.isPopular ? 'default' : 'outline'}
                                        className={cn(
                                          'gap-1.5',
                                          bundle.isPopular && 'bg-campfire-500 hover:bg-campfire-600'
                                        )}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handlePurchaseTokens();
                                        }}
                                      >
                                        <ShoppingCart className="h-3 w-3" />
                                        {formatPrice(bundle.priceCents)}
                                      </Button>
                                    </div>
                                    {wouldAfford && (
                                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                        This will give you enough tokens!
                                      </p>
                                    )}
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={onCancel}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
