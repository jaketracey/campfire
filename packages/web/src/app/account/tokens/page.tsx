'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Route } from 'next';
import { motion } from 'framer-motion';
import { Coins, Check, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useRequireAuth } from '@/hooks/use-auth';
import { FlowguardPayment } from '@/components/payment/flowguard-payment';
import {
  getTokenBalance,
  getTokenBundles,
  createTokenSession,
  type TokenBalance,
  type TokenBundle,
  type PaymentSessionResponse,
} from '@/lib/api/tokens';
import { trackViewTokenBundles, trackInitiateCheckout, trackPurchase } from '@/lib/analytics/meta-pixel';

export default function TokensPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useRequireAuth('/login');

  const [balance, setBalance] = useState<TokenBalance | null>(null);
  const [bundles, setBundles] = useState<TokenBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [paymentSession, setPaymentSession] = useState<PaymentSessionResponse | null>(null);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  // Check for success query param (for redirect-based flows)
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      // Fire Purchase event with stored bundle info
      const storedBundle = sessionStorage.getItem('pending_purchase_bundle');
      if (storedBundle) {
        try {
          const bundle = JSON.parse(storedBundle);
          trackPurchase(bundle.id, bundle.name, bundle.priceCents);
          sessionStorage.removeItem('pending_purchase_bundle');
        } catch (e) {
          console.error('Failed to parse stored bundle:', e);
        }
      }
      toast({
        title: 'Purchase successful!',
        description: 'Your tokens have been added to your account.',
      });
      // Remove the query param
      router.replace('/account/tokens' as Route);
    }
  }, [searchParams, toast, router]);

  // Fetch balance and bundles
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    async function fetchData() {
      setLoading(true);
      try {
        const [balanceData, bundlesData] = await Promise.all([
          getTokenBalance(),
          getTokenBundles(),
        ]);
        setBalance(balanceData);
        setBundles(bundlesData);
        // Track ViewContent when bundles are loaded
        if (bundlesData.length > 0) {
          trackViewTokenBundles(bundlesData.map(b => b.id));
        }
      } catch (err) {
        console.error('Failed to fetch token data:', err);
        toast({
          title: 'Error',
          description: 'Failed to load token information. Please try again.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [authLoading, isAuthenticated, toast]);

  // Refresh balance after changes
  const refreshBalance = async () => {
    try {
      const balanceData = await getTokenBalance();
      setBalance(balanceData);
    } catch (err) {
      console.error('Failed to refresh balance:', err);
    }
  };

  // Refresh balance when page becomes visible (e.g., after admin grants tokens)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isAuthenticated && !loading) {
        refreshBalance();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isAuthenticated, loading]);

  const handlePurchase = async (bundle: TokenBundle) => {
    setPurchasingId(bundle.id);
    // Track InitiateCheckout
    trackInitiateCheckout(bundle.id, bundle.name, bundle.priceCents);
    // Store bundle info for Purchase event after redirect
    sessionStorage.setItem('pending_purchase_bundle', JSON.stringify({
      id: bundle.id,
      name: bundle.name,
      priceCents: bundle.priceCents,
    }));
    try {
      const successUrl = `${window.location.origin}/account/tokens?success=true`;
      const cancelUrl = `${window.location.origin}/account/tokens`;
      const session = await createTokenSession(bundle.id, successUrl, cancelUrl);
      setPaymentSession(session);
      setShowPaymentDialog(true);
    } catch (err) {
      console.error('Failed to create payment session:', err);
      toast({
        title: 'Error',
        description: 'Failed to start checkout. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setPurchasingId(null);
    }
  };

  // Note: Payment success is handled via URL redirect to ?success=true
  // The useEffect at the top of this component handles showing the success toast

  const handlePaymentError = (error: string) => {
    toast({
      title: 'Payment failed',
      description: error,
      variant: 'destructive',
    });
  };

  const handlePaymentCancel = () => {
    setShowPaymentDialog(false);
    setPaymentSession(null);
  };

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Token Balance</h1>
          <p className="text-muted-foreground">
            Purchase tokens to send gifts and unlock special features for your companions.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Current Balance Card */}
            <Card className="mb-8 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-800">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">
                      Current Balance
                    </p>
                    <div className="flex items-center gap-3">
                      <Coins className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                      <span className="text-4xl font-bold text-amber-900 dark:text-amber-100">
                        {balance?.balance?.toLocaleString() ?? 0}
                      </span>
                      <span className="text-lg text-amber-700 dark:text-amber-300">tokens</span>
                    </div>
                  </div>
                  {balance && (
                    <div className="text-right text-sm text-amber-700 dark:text-amber-300">
                      <p>Lifetime purchased: {(balance.lifetimePurchased ?? 0).toLocaleString()}</p>
                      <p>Bonus earned: {(balance.lifetimeBonus ?? 0).toLocaleString()}</p>
                      <p>Total spent: {(balance.lifetimeSpent ?? 0).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Token Bundles */}
            <h2 className="text-xl font-semibold mb-4">Purchase Tokens</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(bundles ?? []).map((bundle) => (
                <Card
                  key={bundle.id}
                  className={`relative overflow-hidden transition-all ${
                    bundle.isPopular
                      ? 'ring-2 ring-campfire-500 border-campfire-500'
                      : 'hover:border-primary/50'
                  }`}
                >
                  {bundle.isPopular && (
                    <div className="absolute top-0 right-0 px-3 py-1 bg-campfire-500 text-white text-xs font-semibold rounded-bl-lg">
                      Most Popular
                    </div>
                  )}
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Coins className="h-5 w-5 text-amber-500" />
                      {bundle.name}
                    </CardTitle>
                    <CardDescription>
                      {bundle.tokens.toLocaleString()} tokens
                      {bundle.bonusTokens > 0 && (
                        <span className="ml-2 text-green-600 dark:text-green-400 font-medium">
                          +{bundle.bonusTokens.toLocaleString()} bonus!
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end justify-between">
                      <div>
                        <span className="text-3xl font-bold">{formatPrice(bundle.priceCents)}</span>
                        <p className="text-xs text-muted-foreground mt-1">
                          {((bundle.priceCents / 100) / (bundle.tokens + bundle.bonusTokens) * 100).toFixed(2)}c per token
                        </p>
                      </div>
                      <motion.button
                        onClick={() => handlePurchase(bundle)}
                        disabled={purchasingId !== null}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className={`
                          relative px-6 py-2.5 rounded-lg font-medium text-white
                          overflow-hidden transition-shadow duration-300
                          disabled:opacity-50 disabled:cursor-not-allowed
                          ${bundle.isPopular
                            ? 'bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 shadow-lg shadow-orange-500/25 hover:shadow-xl hover:shadow-orange-500/30'
                            : 'bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600 shadow-md hover:shadow-lg'
                          }
                        `}
                      >
                        <span className="relative z-10 flex items-center justify-center gap-2">
                          {purchasingId === bundle.id ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            'Purchase'
                          )}
                        </span>
                        {bundle.isPopular && (
                          <motion.div
                            className="absolute inset-0 bg-gradient-to-r from-amber-400/20 via-transparent to-rose-400/20"
                            animate={{
                              x: ['-100%', '100%'],
                            }}
                            transition={{
                              duration: 2,
                              repeat: Infinity,
                              ease: 'linear',
                            }}
                          />
                        )}
                      </motion.button>
                    </div>

                    {/* Features list */}
                    {bundle.bonusTokens > 0 && (
                      <div className="mt-4 pt-4 border-t">
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          <li className="flex items-center gap-2">
                            <Check className="h-4 w-4 text-green-500" />
                            {bundle.tokens.toLocaleString()} base tokens
                          </li>
                          <li className="flex items-center gap-2">
                            <Check className="h-4 w-4 text-green-500" />
                            {bundle.bonusTokens.toLocaleString()} bonus tokens included
                          </li>
                          <li className="flex items-center gap-2">
                            <Check className="h-4 w-4 text-green-500" />
                            {(((bundle.bonusTokens / bundle.tokens) * 100)).toFixed(0)}% extra value
                          </li>
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Info section */}
            <div className="mt-8 p-4 bg-muted/50 rounded-lg">
              <h3 className="font-semibold mb-2">How tokens work</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Tokens are used to send gifts to your AI companions</li>
                <li>- Each gift has a different token cost based on its rarity and meaning</li>
                <li>- Tokens never expire and are tied to your account</li>
                <li>- Larger bundles include bonus tokens for better value</li>
              </ul>
            </div>
          </>
        )}

      {/* Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-500" />
              Purchase Tokens
            </DialogTitle>
          </DialogHeader>
          {paymentSession && (
            <FlowguardPayment
              sessionId={paymentSession.sessionId}
              amount={paymentSession.bundle.priceCents}
              description={`${paymentSession.bundle.name} - ${paymentSession.bundle.totalTokens.toLocaleString()} tokens`}
              onError={handlePaymentError}
              onCancel={handlePaymentCancel}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
