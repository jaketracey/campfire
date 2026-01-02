'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Handshake, ArrowLeft, Save, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { createAffiliate, type CreateAffiliateRequest } from '@/lib/api/affiliates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function NewAffiliatePage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [commissionStandard, setCommissionStandard] = useState<number | ''>(500);
  const [commissionPremium, setCommissionPremium] = useState<number | ''>(2500);
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const input: CreateAffiliateRequest = {
        name,
        email,
        password,
        code: code || undefined,
        commissionStandard: commissionStandard === '' ? undefined : commissionStandard,
        commissionPremium: commissionPremium === '' ? undefined : commissionPremium,
        notes: notes || undefined,
      };

      const result = await createAffiliate(input);
      router.push(`/admin/affiliates/${result.data.id}` as Route);
    } catch (err) {
      console.error('Failed to create affiliate:', err);
      setError(err instanceof Error ? err.message : 'Failed to create affiliate');
    } finally {
      setIsSaving(false);
    }
  };

  // Auto-generate code from name
  const handleNameChange = (value: string) => {
    setName(value);
    if (!code) {
      // Generate a simple code from name (lowercase, alphanumeric only)
      const generatedCode = value
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 12);
      setCode(generatedCode);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={'/admin/affiliates' as Route}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Add Affiliate</h1>
          <p className="text-gray-400 text-sm">Create a new affiliate partner</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="bg-white/[0.02] border-white/5 max-w-2xl">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Handshake className="h-5 w-5 text-campfire-500" />
              Affiliate Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="John Smith"
                  className="bg-white/5 border-white/10"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="bg-white/5 border-white/10"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="bg-white/5 border-white/10 pr-10"
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="code">Affiliate Code</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                  placeholder="Auto-generated or custom"
                  className="bg-white/5 border-white/10"
                  maxLength={20}
                />
                <p className="text-xs text-gray-500">
                  Used in tracking URLs: /ref/{code || 'code'}
                </p>
              </div>
            </div>

            <div className="border-t border-white/5 pt-6">
              <h3 className="text-sm font-medium text-white mb-4">Commission Settings</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="commissionStandard">Standard Plan Commission</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <Input
                      id="commissionStandard"
                      type="number"
                      value={commissionStandard === '' ? '' : (commissionStandard / 100).toFixed(2)}
                      onChange={(e) => {
                        const value = e.target.value;
                        setCommissionStandard(value === '' ? '' : Math.round(parseFloat(value) * 100));
                      }}
                      step="0.01"
                      min="0"
                      placeholder="5.00"
                      className="bg-white/5 border-white/10 pl-7"
                    />
                  </div>
                  <p className="text-xs text-gray-500">Per conversion at $19.99/mo</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="commissionPremium">Premium Plan Commission</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <Input
                      id="commissionPremium"
                      type="number"
                      value={commissionPremium === '' ? '' : (commissionPremium / 100).toFixed(2)}
                      onChange={(e) => {
                        const value = e.target.value;
                        setCommissionPremium(value === '' ? '' : Math.round(parseFloat(value) * 100));
                      }}
                      step="0.01"
                      min="0"
                      placeholder="25.00"
                      className="bg-white/5 border-white/10 pl-7"
                    />
                  </div>
                  <p className="text-xs text-gray-500">Per conversion at $99.95/mo</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Internal Notes (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Private notes about this affiliate..."
                className="bg-white/5 border-white/10 min-h-[80px]"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Link href={'/admin/affiliates' as Route}>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={isSaving || !name || !email || !password || password.length < 8}
                className="gap-2 bg-campfire-600 hover:bg-campfire-700"
              >
                <Save className="h-4 w-4" />
                {isSaving ? 'Creating...' : 'Create Affiliate'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
