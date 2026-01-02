'use client';

import { useEffect, useState, useCallback } from 'react';
import { Save, CreditCard, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { getAffiliateToken } from '@/stores/affiliate-auth-store';
import {
  getAffiliateProfile,
  updateAffiliatePayoutInfo,
  type AffiliateProfile,
  type PayoutInfo,
} from '@/lib/api/affiliates';

export default function AffiliateSettingsPage() {
  const [profile, setProfile] = useState<AffiliateProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Payout form state
  const [payoutType, setPayoutType] = useState<'paypal' | 'bank' | 'other'>('paypal');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [notes, setNotes] = useState('');

  const fetchProfile = useCallback(async () => {
    const token = getAffiliateToken();
    if (!token) return;

    setIsLoading(true);
    try {
      const response = await getAffiliateProfile(token);
      const data = response.data;
      setProfile(data);

      // Populate form from existing payout info
      if (data.payoutInfo) {
        setPayoutType(data.payoutInfo.type);
        setPaypalEmail(data.payoutInfo.paypalEmail || '');
        setBankName(data.payoutInfo.bankName || '');
        setAccountNumber(data.payoutInfo.accountNumber || '');
        setRoutingNumber(data.payoutInfo.routingNumber || '');
        setNotes(data.payoutInfo.notes || '');
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSave = async () => {
    const token = getAffiliateToken();
    if (!token) return;

    setError(null);
    setIsSaving(true);
    setSaved(false);

    try {
      const payoutInfo: PayoutInfo = {
        type: payoutType,
        ...(payoutType === 'paypal' && { paypalEmail }),
        ...(payoutType === 'bank' && { bankName, accountNumber, routingNumber }),
        ...(notes && { notes }),
      };

      await updateAffiliatePayoutInfo(token, { payoutInfo });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to update payout info:', err);
      setError(err instanceof Error ? err.message : 'Failed to update payout information');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-pulse text-gray-500">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold font-display text-white">Settings</h1>
        <p className="text-gray-400 mt-1">Manage your payout information</p>
      </div>

      {/* Account Info */}
      {profile && (
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white">Account Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-gray-500">Name</Label>
                <p className="text-white">{profile.name}</p>
              </div>
              <div>
                <Label className="text-gray-500">Email</Label>
                <p className="text-white">{profile.email}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-gray-500">Affiliate Code</Label>
                <p className="text-campfire-400 font-mono">{profile.code}</p>
              </div>
              <div>
                <Label className="text-gray-500">Member Since</Label>
                <p className="text-white">
                  {new Date(profile.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
              <div>
                <Label className="text-gray-500">Standard Commission</Label>
                <p className="text-white">${(profile.commissionStandard / 100).toFixed(2)} per conversion</p>
              </div>
              <div>
                <Label className="text-gray-500">Premium Commission</Label>
                <p className="text-white">${(profile.commissionPremium / 100).toFixed(2)} per conversion</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payout Settings */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-campfire-500" />
            Payout Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <Label>Payout Method</Label>
            <RadioGroup
              value={payoutType}
              onValueChange={(value) => setPayoutType(value as 'paypal' | 'bank' | 'other')}
              className="grid grid-cols-3 gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="paypal" id="paypal" />
                <Label htmlFor="paypal" className="cursor-pointer">PayPal</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="bank" id="bank" />
                <Label htmlFor="bank" className="cursor-pointer">Bank Transfer</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="other" id="other" />
                <Label htmlFor="other" className="cursor-pointer">Other</Label>
              </div>
            </RadioGroup>
          </div>

          {payoutType === 'paypal' && (
            <div className="space-y-2">
              <Label htmlFor="paypalEmail">PayPal Email</Label>
              <Input
                id="paypalEmail"
                type="email"
                value={paypalEmail}
                onChange={(e) => setPaypalEmail(e.target.value)}
                placeholder="your@email.com"
                className="bg-white/5 border-white/10"
              />
              <p className="text-xs text-gray-500">
                Payments will be sent to this PayPal account
              </p>
            </div>
          )}

          {payoutType === 'bank' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bankName">Bank Name</Label>
                <Input
                  id="bankName"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Bank of America"
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="routingNumber">Routing Number</Label>
                  <Input
                    id="routingNumber"
                    value={routingNumber}
                    onChange={(e) => setRoutingNumber(e.target.value)}
                    placeholder="021000089"
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accountNumber">Account Number</Label>
                  <Input
                    id="accountNumber"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="123456789"
                    className="bg-white/5 border-white/10"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Bank transfer details are securely stored
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional payment instructions..."
              className="bg-white/5 border-white/10 min-h-[80px]"
            />
          </div>

          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="gap-2 bg-campfire-600 hover:bg-campfire-700"
            >
              {saved ? (
                <>
                  <Check className="h-4 w-4" />
                  Saved!
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
