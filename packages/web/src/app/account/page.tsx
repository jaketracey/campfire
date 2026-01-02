'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Flame,
  User,
  Coins,
  ArrowLeft,
  Mail,
  Calendar,
  Shield,
  ChevronRight,
  Sparkles,
  Crown,
  Loader2,
  LogOut,
  Pencil,
  Check,
  X,
  Brain,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useRequireAuth, useAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { getTokenBalance, type TokenBalance } from '@/lib/api/tokens';
import { updateProfile } from '@/lib/api/users';

export default function AccountPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useRequireAuth('/login');
  const { user, logout } = useAuth();

  const [tokenBalance, setTokenBalance] = useState<TokenBalance | null>(null);
  const [loadingTokens, setLoadingTokens] = useState(true);

  // Profile editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const updateUser = useAuthStore((state) => state.updateUser);

  // Privacy settings state
  const [consentToMemory, setConsentToMemory] = useState(true);
  const [consentToLearning, setConsentToLearning] = useState(true);
  const [isSavingPrivacy, setIsSavingPrivacy] = useState(false);

  // Safety level state
  const [safetyLevel, setSafetyLevel] = useState<string>('standard');
  const [isSavingSafety, setIsSavingSafety] = useState(false);

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

  // Load privacy and safety settings from user preferences
  useEffect(() => {
    if (user?.preferences) {
      const prefs = user.preferences as Record<string, unknown>;
      setConsentToMemory((prefs.consentToMemory as boolean) ?? true);
      setConsentToLearning((prefs.consentToLearning as boolean) ?? true);
      setSafetyLevel((prefs.safetyLevel as string) ?? 'standard');
    }
  }, [user?.preferences]);

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

  const handleStartEditing = () => {
    setEditedName(user?.displayName || user?.email?.split('@')[0] || '');
    setIsEditingName(true);
  };

  const handleCancelEditing = () => {
    setIsEditingName(false);
    setEditedName('');
  };

  const handleSaveProfile = async () => {
    if (!user?.id || !editedName.trim()) return;

    setIsSaving(true);
    try {
      const updated = await updateProfile(user.id, { displayName: editedName.trim() });
      updateUser({ displayName: updated.displayName ?? undefined });
      setIsEditingName(false);
    } catch (error) {
      console.error('Failed to update profile:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrivacyChange = async (key: 'consentToMemory' | 'consentToLearning', value: boolean) => {
    if (!user?.id) return;

    // Update local state immediately for responsiveness
    if (key === 'consentToMemory') setConsentToMemory(value);
    if (key === 'consentToLearning') setConsentToLearning(value);

    setIsSavingPrivacy(true);
    try {
      const currentPrefs = (user.preferences as Record<string, unknown>) || {};
      await updateProfile(user.id, {
        preferences: {
          ...currentPrefs,
          [key]: value,
        },
      });
    } catch (error) {
      console.error('Failed to update privacy settings:', error);
      // Revert on error
      if (key === 'consentToMemory') setConsentToMemory(!value);
      if (key === 'consentToLearning') setConsentToLearning(!value);
    } finally {
      setIsSavingPrivacy(false);
    }
  };

  const handleSafetyChange = async (value: string) => {
    if (!user?.id) return;

    // Update local state immediately for responsiveness
    setSafetyLevel(value);

    setIsSavingSafety(true);
    try {
      const currentPrefs = (user.preferences as Record<string, unknown>) || {};
      await updateProfile(user.id, {
        preferences: {
          ...currentPrefs,
          safetyLevel: value,
        },
      });
      // Update local user state in auth store
      updateUser({
        preferences: { ...currentPrefs, safetyLevel: value },
      } as Partial<typeof user>);
    } catch (error) {
      console.error('Failed to update safety level:', error);
      // Revert on error
      const currentPrefs = (user.preferences as Record<string, unknown>) || {};
      setSafetyLevel((currentPrefs.safetyLevel as string) ?? 'standard');
    } finally {
      setIsSavingSafety(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-white/5 px-4 sm:px-6 py-3 sm:py-4 bg-black/20 backdrop-blur-lg">
        <div className="max-w-4xl mx-auto flex items-center gap-3 sm:gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <Flame className="h-6 w-6 sm:h-7 sm:w-7 text-campfire-500 group-hover:scale-110 transition-transform" />
            <span className="text-lg sm:text-xl font-bold text-white">Campfire</span>
          </Link>
          <div className="flex-1" />
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-1 sm:gap-2 text-gray-400 hover:text-white text-xs sm:text-sm">
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back to Dashboard</span>
              <span className="sm:hidden">Back</span>
            </Button>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6 sm:space-y-8"
        >
          {/* Page Header */}
          <div className="space-y-1 sm:space-y-2">
            <h1 className="text-2xl sm:text-4xl font-bold font-display text-white">Account Settings</h1>
            <p className="text-sm sm:text-base text-gray-400">
              Manage your profile, tokens, and subscription
            </p>
          </div>

          {/* Profile Section */}
          <Card className="bg-white/[0.02] border-white/10 backdrop-blur-xl overflow-hidden">
            <CardHeader className="pb-3 sm:pb-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl bg-campfire-500/20 flex items-center justify-center">
                  <User className="h-4 w-4 sm:h-5 sm:w-5 text-campfire-500" />
                </div>
                <div>
                  <CardTitle className="text-lg sm:text-xl text-white">Profile</CardTitle>
                  <CardDescription className="text-xs sm:text-sm text-gray-500">Your account information</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                {/* Display Name */}
                <div className="p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <User className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-500" />
                      <span className="text-xs sm:text-sm text-gray-500">Display Name</span>
                    </div>
                    {!isEditingName && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-gray-500 hover:text-white"
                        onClick={handleStartEditing}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        className="h-8 sm:h-9 text-sm sm:text-base bg-white/5 border-white/10"
                        placeholder="Enter display name"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveProfile();
                          if (e.key === 'Escape') handleCancelEditing();
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                        onClick={handleSaveProfile}
                        disabled={isSaving}
                      >
                        {isSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-gray-500 hover:text-white"
                        onClick={handleCancelEditing}
                        disabled={isSaving}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <p className="text-base sm:text-lg font-medium text-white">
                      {user?.displayName || user?.email?.split('@')[0] || 'Anonymous'}
                    </p>
                  )}
                </div>

                {/* Email */}
                <div className="p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center gap-2 sm:gap-3 mb-2">
                    <Mail className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-500" />
                    <span className="text-xs sm:text-sm text-gray-500">Email</span>
                  </div>
                  <p className="text-base sm:text-lg font-medium text-white truncate">{user?.email || 'Not set'}</p>
                </div>

                {/* Member Since */}
                <div className="p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center gap-2 sm:gap-3 mb-2">
                    <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-500" />
                    <span className="text-xs sm:text-sm text-gray-500">Member Since</span>
                  </div>
                  <p className="text-base sm:text-lg font-medium text-white">{memberSince}</p>
                </div>

                {/* Account Status */}
                <div className="p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center gap-2 sm:gap-3 mb-2">
                    <Shield className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-500" />
                    <span className="text-xs sm:text-sm text-gray-500">Account Status</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    <p className="text-base sm:text-lg font-medium text-white">Active</p>
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

          {/* Privacy & Memory Section */}
          <Card className="bg-white/[0.02] border-white/10 backdrop-blur-xl overflow-hidden">
            <CardHeader className="pb-3 sm:pb-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <ShieldCheck className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
                </div>
                <div>
                  <CardTitle className="text-lg sm:text-xl text-white">Privacy & Memory</CardTitle>
                  <CardDescription className="text-xs sm:text-sm text-gray-500">
                    Control how companions remember and learn
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 sm:space-y-6">
              {/* Long-term Memory */}
              <div className="flex items-center justify-between gap-4 p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-green-500" />
                    <Label className="text-sm sm:text-base font-medium text-white">Long-term Memory</Label>
                  </div>
                  <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">
                    Allow companions to remember the heart of your conversations and build a shared history.
                  </p>
                </div>
                <Switch
                  checked={consentToMemory}
                  onCheckedChange={(checked) => handlePrivacyChange('consentToMemory', checked)}
                  disabled={isSavingPrivacy}
                  className="data-[state=checked]:bg-green-500"
                />
              </div>

              {/* Active Evolution */}
              <div className="flex items-center justify-between gap-4 p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-500" />
                    <Label className="text-sm sm:text-base font-medium text-white">Active Evolution</Label>
                  </div>
                  <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">
                    Let companions evolve their personality and perspective based on your unique interactions.
                  </p>
                </div>
                <Switch
                  checked={consentToLearning}
                  onCheckedChange={(checked) => handlePrivacyChange('consentToLearning', checked)}
                  disabled={isSavingPrivacy}
                  className="data-[state=checked]:bg-cyan-500"
                />
              </div>
            </CardContent>
          </Card>

          {/* Content & Safety Section */}
          <Card className="bg-white/[0.02] border-white/10 backdrop-blur-xl overflow-hidden">
            <CardHeader className="pb-3 sm:pb-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl bg-rose-500/20 flex items-center justify-center">
                  <Shield className="h-4 w-4 sm:h-5 sm:w-5 text-rose-500" />
                </div>
                <div>
                  <CardTitle className="text-lg sm:text-xl text-white">Content & Safety</CardTitle>
                  <CardDescription className="text-xs sm:text-sm text-gray-500">
                    Set your content preferences for conversations
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs sm:text-sm text-gray-400">
                Your safety preference works with each companion&apos;s content rating.
                The more restrictive setting always applies.
              </p>
              <RadioGroup
                value={safetyLevel}
                onValueChange={handleSafetyChange}
                disabled={isSavingSafety}
                className="space-y-3"
              >
                {/* Strict (G) */}
                <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
                  <RadioGroupItem value="strict" id="safety-strict" className="mt-1" />
                  <Label htmlFor="safety-strict" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">Strict</span>
                      <span className="px-1.5 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">
                        G
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Clean, family-friendly content only. No mature themes.
                    </p>
                  </Label>
                </div>

                {/* Standard (PG) */}
                <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
                  <RadioGroupItem value="standard" id="safety-standard" className="mt-1" />
                  <Label htmlFor="safety-standard" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">Standard</span>
                      <span className="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                        PG
                      </span>
                      <span className="px-1.5 py-0.5 text-xs bg-gray-500/20 text-gray-400 rounded">
                        Default
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Mild themes allowed. Suitable for general audiences.
                    </p>
                  </Label>
                </div>

                {/* Mature (PG-13) */}
                <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
                  <RadioGroupItem value="permissive" id="safety-permissive" className="mt-1" />
                  <Label htmlFor="safety-permissive" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">Mature</span>
                      <span className="px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded">
                        PG-13
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Teen-appropriate content. Some suggestive themes allowed.
                    </p>
                  </Label>
                </div>

                {/* Adult (R) */}
                <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
                  <RadioGroupItem value="adult" id="safety-adult" className="mt-1" />
                  <Label htmlFor="safety-adult" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">Adult</span>
                      <span className="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
                        R
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Unrestricted adult content. No filtering applied.
                    </p>
                  </Label>
                </div>
              </RadioGroup>
              {isSavingSafety && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving...
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tokens Section */}
          <Card className="bg-white/[0.02] border-white/10 backdrop-blur-xl overflow-hidden">
            <CardHeader className="pb-3 sm:pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <Coins className="h-4 w-4 sm:h-5 sm:w-5 text-amber-500" />
                  </div>
                  <div>
                    <CardTitle className="text-lg sm:text-xl text-white">Token Balance</CardTitle>
                    <CardDescription className="text-xs sm:text-sm text-gray-500">
                      Use tokens to send gifts to companions
                    </CardDescription>
                  </div>
                </div>
                <Link href="/account/tokens">
                  <Button className="gap-2 bg-amber-600 hover:bg-amber-500 text-white text-sm w-full sm:w-auto">
                    <Sparkles className="h-4 w-4" />
                    Buy Tokens
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {loadingTokens ? (
                <div className="flex items-center justify-center py-6 sm:py-8">
                  <Loader2 className="h-5 w-5 sm:h-6 sm:w-6 animate-spin text-gray-500" />
                </div>
              ) : (
                <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent border border-amber-500/20">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <Coins className="h-8 w-8 sm:h-10 sm:w-10 text-amber-500" />
                      <div>
                        <p className="text-xs sm:text-sm text-amber-400/80 font-medium">Current Balance</p>
                        <p className="text-2xl sm:text-4xl font-bold text-white">
                          {tokenBalance?.balance?.toLocaleString() ?? 0}
                          <span className="text-sm sm:text-lg text-gray-400 ml-1 sm:ml-2">tokens</span>
                        </p>
                      </div>
                    </div>
                    {tokenBalance && (
                      <div className="text-left sm:text-right text-xs sm:text-sm text-gray-500 space-y-0.5 sm:space-y-1">
                        <p>Lifetime purchased: {tokenBalance.lifetimePurchased?.toLocaleString() ?? 0}</p>
                        <p>Bonus earned: {tokenBalance.lifetimeBonus?.toLocaleString() ?? 0}</p>
                        <p>Total spent: {tokenBalance.lifetimeSpent?.toLocaleString() ?? 0}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subscription Section */}
          <Card className="bg-white/[0.02] border-white/10 backdrop-blur-xl overflow-hidden">
            <CardHeader className="pb-3 sm:pb-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                  <Crown className="h-4 w-4 sm:h-5 sm:w-5 text-purple-500" />
                </div>
                <div>
                  <CardTitle className="text-lg sm:text-xl text-white">Subscription</CardTitle>
                  <CardDescription className="text-xs sm:text-sm text-gray-500">
                    Manage your plan and billing
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              {/* Current Plan */}
              <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 via-violet-500/5 to-transparent border border-purple-500/20">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                  <div>
                    <p className="text-xs sm:text-sm text-purple-400/80 font-medium mb-1">Current Plan</p>
                    <p className="text-xl sm:text-2xl font-bold text-white">Free Tier</p>
                    <p className="text-xs sm:text-sm text-gray-500 mt-1">
                      Basic access to companion features
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="gap-2 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300 text-sm w-full sm:w-auto"
                    disabled
                  >
                    <Crown className="h-4 w-4" />
                    Upgrade
                    <span className="text-xs text-gray-500">(Coming Soon)</span>
                  </Button>
                </div>
              </div>

              {/* Plan Features */}
              <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <div className="p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                  <p className="text-lg sm:text-2xl font-bold text-white">3</p>
                  <p className="text-xs sm:text-sm text-gray-500">Companions</p>
                </div>
                <div className="p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                  <p className="text-lg sm:text-2xl font-bold text-white">Unlimited</p>
                  <p className="text-xs sm:text-sm text-gray-500">Conversations</p>
                </div>
                <div className="p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                  <p className="text-lg sm:text-2xl font-bold text-white">Basic</p>
                  <p className="text-xs sm:text-sm text-gray-500">Voice Options</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card className="bg-white/[0.02] border-white/10 backdrop-blur-xl overflow-hidden">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="text-lg sm:text-xl text-white">Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                href="/account/tokens"
                className="flex items-center justify-between p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all group"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  <Coins className="h-4 w-4 sm:h-5 sm:w-5 text-amber-500" />
                  <span className="text-sm sm:text-base text-white font-medium">Purchase Tokens</span>
                </div>
                <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-gray-500 group-hover:text-white transition-colors" />
              </Link>

              <button
                onClick={logout}
                className="w-full flex items-center justify-between p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-red-500/10 hover:border-red-500/20 transition-all group"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  <LogOut className="h-4 w-4 sm:h-5 sm:w-5 text-red-500" />
                  <span className="text-sm sm:text-base text-gray-400 group-hover:text-red-400 font-medium transition-colors">
                    Sign Out
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-gray-500 group-hover:text-red-400 transition-colors" />
              </button>
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
