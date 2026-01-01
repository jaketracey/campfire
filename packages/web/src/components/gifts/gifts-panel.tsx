'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Gift, History, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TokenBalanceDisplay } from './token-balance-display';
import { GiftCard } from './gift-card';
import { GiftSendConfirmation } from './gift-send-confirmation';
import { GiftAnimation, type GiftAnimationType } from './gift-animation';
import { useGiftsStore } from '@/stores/gifts-store';
import {
  generateGift,
  giveGift,
  getGiftHistory,
  type Gift as GiftType,
  type GiftHistoryItem,
} from '@/lib/api/gifts';
import { getTokenBalance } from '@/lib/api/tokens';

interface GiftsPanelProps {
  sessionId: string;
  companionId: string;
  isOpen: boolean;
  onClose: () => void;
  onGiftSent?: (gift: GiftType) => void;
}

export function GiftsPanel({
  sessionId,
  companionId,
  isOpen,
  onClose,
  onGiftSent,
}: GiftsPanelProps) {
  const [activeTab, setActiveTab] = useState('send');
  const [giftHistory, setGiftHistory] = useState<GiftHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [animationType, setAnimationType] = useState<GiftAnimationType | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const {
    tokenBalance,
    selectedGift,
    isLoadingGifts,
    isSendingGift,
    error,
    setTokenBalance,
    selectGift,
    setIsLoadingGifts,
    setIsSendingGift,
    setError,
    clearGifts,
  } = useGiftsStore();

  // Fetch token balance on mount
  useEffect(() => {
    if (isOpen) {
      fetchTokenBalance();
    }
  }, [isOpen]);

  // Fetch history when history tab is active
  useEffect(() => {
    if (isOpen && activeTab === 'history') {
      fetchGiftHistory();
    }
  }, [isOpen, activeTab, companionId]);

  // Clean up on close
  useEffect(() => {
    if (!isOpen) {
      selectGift(null);
      setError(null);
    }
  }, [isOpen, selectGift, setError]);

  const fetchTokenBalance = useCallback(async () => {
    try {
      const balance = await getTokenBalance();
      setTokenBalance(balance.balance);
    } catch (err) {
      console.error('Failed to fetch token balance:', err);
    }
  }, [setTokenBalance]);

  const fetchGiftHistory = useCallback(async () => {
    // Validate companionId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!companionId || !uuidRegex.test(companionId)) {
      console.warn('Invalid companion ID for gift history:', companionId);
      return;
    }

    setLoadingHistory(true);
    try {
      const history = await getGiftHistory(companionId, 20);
      setGiftHistory(history);
    } catch (err) {
      console.error('Failed to fetch gift history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [companionId]);

  const handleGenerateGift = useCallback(async () => {
    // Validate companionId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!companionId || !uuidRegex.test(companionId)) {
      setError('Invalid companion ID');
      return;
    }

    setIsLoadingGifts(true);
    setError(null);
    selectGift(null);

    try {
      const gift = await generateGift(companionId);
      selectGift(gift);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate gift');
    } finally {
      setIsLoadingGifts(false);
    }
  }, [companionId, selectGift, setIsLoadingGifts, setError]);

  const handleSendGift = useCallback(async () => {
    if (!selectedGift) return;

    setIsSendingGift(true);
    setError(null);

    try {
      const result = await giveGift(selectedGift.id);
      setTokenBalance(result.newBalance);

      // Close confirmation and trigger animation
      setShowConfirmation(false);

      // Pick a random animation type
      const animations: GiftAnimationType[] = ['hearts', 'sparkles', 'confetti', 'glow'];
      setAnimationType(animations[Math.floor(Math.random() * animations.length)]);
      setIsAnimating(true);

      // Notify parent
      if (onGiftSent) {
        onGiftSent(result.gift);
      }

      // Clear the selected gift after animation
      setTimeout(() => {
        selectGift(null);
        setIsAnimating(false);
        setAnimationType(null);
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send gift');
      setShowConfirmation(false);
    } finally {
      setIsSendingGift(false);
    }
  }, [selectedGift, setIsSendingGift, setError, setTokenBalance, selectGift, onGiftSent]);

  const canAffordGift = selectedGift ? tokenBalance >= selectedGift.tokenCost : false;

  // Validate companionId is a valid UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isValidCompanionId = companionId && uuidRegex.test(companionId);

  if (!isOpen) return null;

  if (!isValidCompanionId) {
    return (
      <div className="fixed bottom-4 right-4 w-[400px] z-50 shadow-2xl rounded-lg border bg-background p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-sm">Gifts</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Unable to load gifts. Please refresh the page.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-[400px] max-h-[500px] z-50 shadow-2xl rounded-lg border bg-background">
      {/* Animation overlay */}
      {animationType && (
        <GiftAnimation
          type={animationType}
          isPlaying={isAnimating}
          onComplete={() => {
            setIsAnimating(false);
            setAnimationType(null);
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50 rounded-t-lg">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-campfire-500" />
          <span className="font-semibold text-sm">Gifts</span>
        </div>
        <div className="flex items-center gap-2">
          <TokenBalanceDisplay balance={tokenBalance} showPurchaseLink compact />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="p-3">
        <TabsList className="grid w-full grid-cols-2 h-9">
          <TabsTrigger value="send" className="text-xs gap-1">
            <Sparkles className="h-3 w-3" />
            Send Gift
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs gap-1">
            <History className="h-3 w-3" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Send Gift Tab */}
        <TabsContent value="send">
          <ScrollArea className="h-[350px]">
            <div className="space-y-4 pr-2">
              {/* Error message */}
              {error && (
                <div className="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded">
                  {error}
                </div>
              )}

              {/* Generate Gift Button */}
              {!selectedGift && !isLoadingGifts && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="w-16 h-16 rounded-full bg-campfire-100 dark:bg-campfire-900/30 flex items-center justify-center mb-4">
                    <Gift className="h-8 w-8 text-campfire-500" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">
                    Create a Special Gift
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4 max-w-[280px]">
                    Generate a unique gift for your companion. Each gift has a
                    special emotional meaning.
                  </p>
                  <Button onClick={handleGenerateGift} className="gap-2">
                    <Sparkles className="h-4 w-4" />
                    Generate Gift
                  </Button>
                </div>
              )}

              {/* Loading state */}
              {isLoadingGifts && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-campfire-500 mb-4" />
                  <p className="text-sm text-muted-foreground">
                    Creating something special...
                  </p>
                </div>
              )}

              {/* Selected Gift */}
              {selectedGift && !isLoadingGifts && (
                <div className="space-y-4">
                  <GiftCard gift={selectedGift} size="lg" />

                  {/* Insufficient balance warning */}
                  {!canAffordGift && (
                    <div className="p-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800">
                      You need {selectedGift.tokenCost - tokenBalance} more tokens
                      to send this gift.
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 gap-2"
                      onClick={handleGenerateGift}
                      disabled={isLoadingGifts}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Generate New
                    </Button>
                    <Button
                      className="flex-1 gap-2"
                      onClick={() => setShowConfirmation(true)}
                      disabled={!canAffordGift || isSendingGift}
                    >
                      <Gift className="h-4 w-4" />
                      Send Gift
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <ScrollArea className="h-[350px]">
            {loadingHistory ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading history...
              </div>
            ) : giftHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <History className="h-8 w-8 mb-3 opacity-50" />
                <p className="text-sm">No gifts sent yet</p>
                <p className="text-xs mt-1">
                  Send your first gift to see it here!
                </p>
              </div>
            ) : (
              <div className="space-y-3 pr-2">
                {giftHistory.map((item) => (
                  <div key={item.gift.id} className="space-y-2">
                    <GiftCard gift={item.gift} size="sm" />
                    {item.companionReaction && (
                      <div className="ml-4 p-2 text-xs italic text-muted-foreground bg-muted/50 rounded">
                        "{item.companionReaction}"
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Send Confirmation Dialog */}
      <GiftSendConfirmation
        gift={selectedGift}
        isOpen={showConfirmation}
        onConfirm={handleSendGift}
        onCancel={() => setShowConfirmation(false)}
        isSending={isSendingGift}
      />
    </div>
  );
}
