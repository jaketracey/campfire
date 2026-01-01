'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Flame,
  User,
  Coins,
  CreditCard,
  ArrowLeft,
  Mail,
  Calendar,
  Shield,
  ChevronRight,
  Sparkles,
  Crown,
  Loader2,
  LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRequireAuth, useAuth } from '@/hooks/use-auth';
import { getTokenBalance, type TokenBalance } from '@/lib/api/tokens';

export default function AccountPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useRequireAuth('/login');
  const { user, logout } = useAuth();

  const [tokenBalance, setTokenBalance] = useState<TokenBalance | null>(null);
  const [loadingTokens, setLoadingTokens] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;

    async function fetchTokenBalance() {
      try {
        const balance = await getTokenBalance();
        setTokenBalance(balance);
      } catch (err) {
        console.error('Failed to fetch token balance:', err);
      } finally {
        setLoadingTokens(false);
      }
    }

    fetchTokenBalance();
  }, [isAuthenticated]);

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

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      })
    : 'Unknown';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-white/5 px-6 py-4 bg-black/20 backdrop-blur-lg">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <Flame className="h-7 w-7 text-campfire-500 group-hover:scale-110 transition-transform" />
            <span className="text-xl font-bold text-white">Campfire</span>
          </Link>
          <div className="flex-1" />
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2 text-gray-400 hover:text-white">
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Page Header */}
          <div className="space-y-2">
            <h1 className="text-4xl font-bold font-display text-white">Account Settings</h1>
            <p className="text-gray-400">
              Manage your profile, tokens, and subscription
            </p>
          </div>

          {/* Profile Section */}
          <Card className="bg-white/[0.02] border-white/10 backdrop-blur-xl overflow-hidden">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-campfire-500/20 flex items-center justify-center">
                  <User className="h-5 w-5 text-campfire-500" />
                </div>
                <div>
                  <CardTitle className="text-xl text-white">Profile</CardTitle>
                  <CardDescription className="text-gray-500">Your account information</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Display Name */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center gap-3 mb-2">
                    <User className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-500">Display Name</span>
                  </div>
                  <p className="text-lg font-medium text-white">
                    {user?.displayName || user?.email?.split('@')[0] || 'Anonymous'}
                  </p>
                </div>

                {/* Email */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center gap-3 mb-2">
                    <Mail className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-500">Email</span>
                  </div>
                  <p className="text-lg font-medium text-white">{user?.email || 'Not set'}</p>
                </div>

                {/* Member Since */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center gap-3 mb-2">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-500">Member Since</span>
                  </div>
                  <p className="text-lg font-medium text-white">{memberSince}</p>
                </div>

                {/* Account Status */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center gap-3 mb-2">
                    <Shield className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-500">Account Status</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    <p className="text-lg font-medium text-white">Active</p>
                    {user?.role === 'admin' && (
                      <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-campfire-500/20 text-campfire-400 rounded-full">
                        Admin
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tokens Section */}
          <Card className="bg-white/[0.02] border-white/10 backdrop-blur-xl overflow-hidden">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <Coins className="h-5 w-5 text-amber-500" />
                  </div>
                  <div>
                    <CardTitle className="text-xl text-white">Token Balance</CardTitle>
                    <CardDescription className="text-gray-500">
                      Use tokens to send gifts to companions
                    </CardDescription>
                  </div>
                </div>
                <Link href="/account/tokens">
                  <Button className="gap-2 bg-amber-600 hover:bg-amber-500 text-white">
                    <Sparkles className="h-4 w-4" />
                    Buy Tokens
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {loadingTokens ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                </div>
              ) : (
                <div className="p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent border border-amber-500/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Coins className="h-10 w-10 text-amber-500" />
                      <div>
                        <p className="text-sm text-amber-400/80 font-medium">Current Balance</p>
                        <p className="text-4xl font-bold text-white">
                          {tokenBalance?.balance.toLocaleString() ?? 0}
                          <span className="text-lg text-gray-400 ml-2">tokens</span>
                        </p>
                      </div>
                    </div>
                    {tokenBalance && (
                      <div className="text-right text-sm text-gray-500 space-y-1">
                        <p>Lifetime purchased: {tokenBalance.lifetimePurchased.toLocaleString()}</p>
                        <p>Bonus earned: {tokenBalance.lifetimeBonus.toLocaleString()}</p>
                        <p>Total spent: {tokenBalance.lifetimeSpent.toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subscription Section */}
          <Card className="bg-white/[0.02] border-white/10 backdrop-blur-xl overflow-hidden">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                  <Crown className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <CardTitle className="text-xl text-white">Subscription</CardTitle>
                  <CardDescription className="text-gray-500">
                    Manage your plan and billing
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current Plan */}
              <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 via-violet-500/5 to-transparent border border-purple-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-purple-400/80 font-medium mb-1">Current Plan</p>
                    <p className="text-2xl font-bold text-white">Free Tier</p>
                    <p className="text-sm text-gray-500 mt-1">
                      Basic access to companion features
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="gap-2 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300"
                    disabled
                  >
                    <Crown className="h-4 w-4" />
                    Upgrade
                    <span className="text-xs text-gray-500">(Coming Soon)</span>
                  </Button>
                </div>
              </div>

              {/* Plan Features */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                  <p className="text-2xl font-bold text-white">3</p>
                  <p className="text-sm text-gray-500">Companions</p>
                </div>
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                  <p className="text-2xl font-bold text-white">Unlimited</p>
                  <p className="text-sm text-gray-500">Conversations</p>
                </div>
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                  <p className="text-2xl font-bold text-white">Basic</p>
                  <p className="text-sm text-gray-500">Voice Options</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card className="bg-white/[0.02] border-white/10 backdrop-blur-xl overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl text-white">Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                href="/account/tokens"
                className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <Coins className="h-5 w-5 text-amber-500" />
                  <span className="text-white font-medium">Purchase Tokens</span>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-500 group-hover:text-white transition-colors" />
              </Link>

              <button
                onClick={logout}
                className="w-full flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-red-500/10 hover:border-red-500/20 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <LogOut className="h-5 w-5 text-red-500" />
                  <span className="text-gray-400 group-hover:text-red-400 font-medium transition-colors">
                    Sign Out
                  </span>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-500 group-hover:text-red-400 transition-colors" />
              </button>
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
