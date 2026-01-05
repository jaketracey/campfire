'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, RefreshCw, Gift, History, Sparkles, Loader2, Grid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TokenBalanceDisplay } from './token-balance-display';
import { GiftCard } from './gift-card';
import { GiftSendConfirmation } from './gift-send-confirmation';
import { GiftAnimation, type GiftAnimationType } from './gift-animation';
import { GiftTemplateGrid } from './gift-template-grid';
import { GiftCategoryFilter } from './gift-category-filter';
import { GiftSortDropdown } from './gift-sort-dropdown';
import { useGiftsStore } from '@/stores/gifts-store';
import { useAuthStore } from '@/stores/auth-store';
import {
  generateGift,
  getGift,
  giveGift,
  getGiftHistory,
  sendGiftFromTemplate,
  type Gift as GiftType,
  type GiftHistoryItem,
  type GiftTemplate,
} from '@/lib/api/gifts';
import { getTokenBalance } from '@/lib/api/tokens';
import { trackGiftSent } from '@/lib/analytics/meta-pixel';

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
  const [activeTab, setActiveTab] = useState('browse');
  const [giftHistory, setGiftHistory] = useState<GiftHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [animationType, setAnimationType] = useState<GiftAnimationType | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  // Ref to track polling timeout for cleanup
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    // Template state
    selectedTemplate,
    templateCategory,
    templateSort,
    selectTemplate,
    setTemplateCategory,
    setTemplateSort,
    clearTemplates,
  } = useGiftsStore();

  const isAuthInitialized = useAuthStore((state) => state.isInitialized);

  // Fetch token balance on mount (only after auth is initialized)
  useEffect(() => {
    if (isOpen && isAuthInitialized) {
      fetchTokenBalance();
    }
  }, [isOpen, isAuthInitialized]);

  // Fetch history when history tab is active (only after auth is initialized)
  useEffect(() => {
    if (isOpen && activeTab === 'history' && isAuthInitialized) {
      fetchGiftHistory();
    }
  }, [isOpen, activeTab, companionId, isAuthInitialized]);

  // Clean up on close
  useEffect(() => {
    if (!isOpen) {
      // Clear any pending poll
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
      selectGift(null);
      selectTemplate(null);
      setError(null);
      setIsLoadingGifts(false);
    }
  }, [isOpen, selectGift, selectTemplate, setError, setIsLoadingGifts]);

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

  // Poll for gift completion
  const pollForGiftCompletion = useCallback(
    (giftId: string) => {
      const maxAttempts = 60; // 2 minutes at 2s intervals
      let attempts = 0;

      const poll = async () => {
        try {
          const gift = await getGift(giftId);

          if (gift.status === 'ready') {
            selectGift(gift);
            setIsLoadingGifts(false);
            pollTimeoutRef.current = null;
            return;
          }

          if (gift.status === 'failed') {
            setError('Gift generation failed. Please try again.');
            setIsLoadingGifts(false);
            selectGift(null);
            pollTimeoutRef.current = null;
            return;
          }

          attempts++;
          if (attempts >= maxAttempts) {
            setError('Gift generation timed out. Please try again.');
            setIsLoadingGifts(false);
            selectGift(null);
            pollTimeoutRef.current = null;
            return;
          }

          // Continue polling
          pollTimeoutRef.current = setTimeout(poll, 2000);
        } catch (err) {
          console.error('Poll error:', err);
          setError('Failed to check gift status');
          setIsLoadingGifts(false);
          selectGift(null);
          pollTimeoutRef.current = null;
        }
      };

      // Start polling
      poll();
    },
    [selectGift, setError, setIsLoadingGifts]
  );

  const handleGenerateGift = useCallback(async () => {
    // Validate companionId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!companionId || !uuidRegex.test(companionId)) {
      setError('Invalid companion ID');
      return;
    }

    // Clear any existing poll
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }

    setIsLoadingGifts(true);
    setError(null);
    selectGift(null);

    try {
      const gift = await generateGift(companionId);

      // If gift is still generating, start polling
      if (gift.status === 'generating') {
        pollForGiftCompletion(gift.id);
      } else if (gift.status === 'ready') {
        // Gift is already ready (cached?)
        selectGift(gift);
        setIsLoadingGifts(false);
      } else if (gift.status === 'failed') {
        setError('Gift generation failed. Please try again.');
        setIsLoadingGifts(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate gift');
      setIsLoadingGifts(false);
    }
  }, [companionId, selectGift, setIsLoadingGifts, setError, pollForGiftCompletion]);

  const handleSendGift = useCallback(async () => {
    if (!selectedGift) return;

    setIsSendingGift(true);
    setError(null);

    try {
      const result = await giveGift(selectedGift.id);
      setTokenBalance(result.newBalance);

      // Track gift sent event
      trackGiftSent('custom', selectedGift.tokenCost, companionId);

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

  // Handler for selecting a template
  const handleSelectTemplate = useCallback((template: GiftTemplate) => {
    selectTemplate(template);
  }, [selectTemplate]);

  // Handler for sending from a template
  const handleSendFromTemplate = useCallback(async () => {
    if (!selectedTemplate) return;

    setIsSendingGift(true);
    setError(null);

    try {
      const result = await sendGiftFromTemplate(selectedTemplate.id, companionId);
      setTokenBalance(result.newBalance);

      // Track gift sent event (template gift)
      trackGiftSent('template', selectedTemplate.tokenCost, companionId);

      // Trigger animation
      const animations: GiftAnimationType[] = ['hearts', 'sparkles', 'confetti', 'glow'];
      setAnimationType(animations[Math.floor(Math.random() * animations.length)]);
      setIsAnimating(true);

      // Notify parent
      if (onGiftSent) {
        onGiftSent({
          id: result.gift.id,
          name: result.gift.name,
          description: selectedTemplate.description ?? '',
          imageUrl: selectedTemplate.imageUrl,
          tokenCost: selectedTemplate.tokenCost,
          emotionalMeaning: selectedTemplate.emotionalMeaning ?? '',
          status: result.gift.status,
          givenAt: result.gift.givenAt,
          createdAt: '',
        });
      }

      // Clear selection after animation
      setTimeout(() => {
        selectTemplate(null);
        setIsAnimating(false);
        setAnimationType(null);
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send gift');
    } finally {
      setIsSendingGift(false);
    }
  }, [selectedTemplate, companionId, setIsSendingGift, setError, setTokenBalance, selectTemplate, onGiftSent]);

  const canAffordGift = selectedGift ? tokenBalance >= selectedGift.tokenCost : false;
  const canAffordTemplate = selectedTemplate ? tokenBalance >= selectedTemplate.tokenCost : false;

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
        <TabsList className="grid w-full grid-cols-3 h-9">
          <TabsTrigger value="browse" className="text-xs gap-1">
            <Grid className="h-3 w-3" />
            Browse
          </TabsTrigger>
          <TabsTrigger value="custom" className="text-xs gap-1">
            <Sparkles className="h-3 w-3" />
            Custom
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs gap-1">
            <History className="h-3 w-3" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Browse Templates Tab */}
        <TabsContent value="browse">
          <div className="space-y-3">
            {/* Filters */}
            <div className="flex items-center justify-between gap-2">
              <GiftCategoryFilter
                selected={templateCategory}
                onChange={setTemplateCategory}
              />
            </div>
            <div className="flex justify-end">
              <GiftSortDropdown value={templateSort} onChange={setTemplateSort} />
            </div>

            {/* Error message */}
            {error && (
              <div className="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded">
                {error}
              </div>
            )}

            <ScrollArea className="h-[280px]">
              <GiftTemplateGrid
                onSelect={handleSelectTemplate}
                selectedId={selectedTemplate?.id}
              />
            </ScrollArea>

            {/* Selected template action */}
            {selectedTemplate && (
              <div className="pt-2 border-t space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium truncate">{selectedTemplate.name}</span>
                  <span className="text-muted-foreground">{selectedTemplate.tokenCost} tokens</span>
                </div>
                {!canAffordTemplate && (
                  <div className="text-xs text-amber-600 dark:text-amber-400">
                    You need {selectedTemplate.tokenCost - tokenBalance} more tokens
                  </div>
                )}
                <Button
                  className="w-full gap-2"
                  onClick={handleSendFromTemplate}
                  disabled={!canAffordTemplate || isSendingGift}
                >
                  {isSendingGift ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Gift className="h-4 w-4" />
                  )}
                  Send Gift
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Custom Gift Tab */}
        <TabsContent value="custom">
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
                    <Sparkles className="h-8 w-8 text-campfire-500" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">
                    Create a Unique Gift
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4 max-w-[280px]">
                    Generate a one-of-a-kind gift tailored to your companion.
                  </p>
                  <Button onClick={handleGenerateGift} className="gap-2">
                    <Sparkles className="h-4 w-4" />
                    Generate Custom Gift
                  </Button>
                </div>
              )}

              {/* Loading state */}
              {isLoadingGifts && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-campfire-500 mb-4" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    Creating your gift
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Generating something special just for your companion...
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
