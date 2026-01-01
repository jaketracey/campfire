'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { Flame, Coins, ArrowLeft, Sparkles, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  getTokenBalance,
  getTokenBundles,
  createTokenCheckout,
  type TokenBalance,
  type TokenBundle,
} from '@/lib/api/tokens';

export default function TokensPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useRequireAuth('/login');

  const [balance, setBalance] = useState<TokenBalance | null>(null);
  const [bundles, setBundles] = useState<TokenBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  // Check for success query param
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
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

  const handlePurchase = async (bundle: TokenBundle) => {
    setPurchasingId(bundle.id);
    try {
      const successUrl = `${window.location.origin}/account/tokens?success=true`;
      const cancelUrl = `${window.location.origin}/account/tokens`;
      const { url } = await createTokenCheckout(bundle.id, successUrl, cancelUrl);
      window.location.href = url;
    } catch (err) {
      console.error('Failed to create checkout:', err);
      toast({
        title: 'Error',
        description: 'Failed to start checkout. Please try again.',
        variant: 'destructive',
      });
      setPurchasingId(null);
    }
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <Flame className="h-7 w-7 text-campfire-500 group-hover:scale-110 transition-transform" />
            <span className="text-xl font-bold">Campfire</span>
          </Link>
          <div className="flex-1" />
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
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
              {bundles.map((bundle) => (
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
                      <Button
                        onClick={() => handlePurchase(bundle)}
                        disabled={purchasingId !== null}
                        className={bundle.isPopular ? 'bg-campfire-500 hover:bg-campfire-600' : ''}
                      >
                        {purchasingId === bundle.id ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-2" />
                            Purchase
                          </>
                        )}
                      </Button>
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
      </main>
    </div>
  );
}
