'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Store } from 'lucide-react';
import { createTenant, type TenantBrandConfig, type TenantStatus } from '@/lib/api/tenants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export default function NewTenantPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ownerUserId, setOwnerUserId] = useState('');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [brand, setBrand] = useState<TenantBrandConfig>({
    name: '',
    shortName: '',
    supportEmail: '',
    legalEmail: '',
    primaryHsl: '',
    primaryForegroundHsl: '',
    logoUrl: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const status: TenantStatus = isActive ? 'active' : 'suspended';
      const brandConfig: TenantBrandConfig = Object.fromEntries(
        Object.entries(brand).filter(([, v]) => (v ?? '').toString().trim() !== '')
      );

      const res = await createTenant({
        ownerUserId,
        slug,
        name,
        status,
        brandConfig,
      });

      router.push(`/admin/tenants/${res.data.id}` as Route);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tenant');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={'/admin/tenants' as Route}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Add Tenant</h1>
          <p className="text-gray-400 text-sm">Create a new white-label tenant</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="bg-white/[0.02] border-white/5 max-w-3xl">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Store className="h-5 w-5 text-campfire-500" />
              Tenant Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ownerUserId">Owner User ID</Label>
              <Input
                id="ownerUserId"
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
                placeholder="UUID of the tenant owner"
                className="bg-white/5 border-white/10 font-mono"
                required
              />
              <p className="text-xs text-gray-500">Each user can own at most one tenant.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g., creator-name"
                  className="bg-white/5 border-white/10 font-mono"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Creator Brand"
                  className="bg-white/5 border-white/10"
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="isActive">Active</Label>
              <Switch id="isActive" checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="pt-2 border-t border-white/5">
              <h3 className="text-white font-medium mb-3">Brand Overrides (optional)</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="brandName">Brand Name</Label>
                  <Input
                    id="brandName"
                    value={brand.name ?? ''}
                    onChange={(e) => setBrand((b) => ({ ...b, name: e.target.value }))}
                    placeholder="Overrides tenant name in UI"
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brandShortName">Short Name</Label>
                  <Input
                    id="brandShortName"
                    value={brand.shortName ?? ''}
                    onChange={(e) => setBrand((b) => ({ ...b, shortName: e.target.value }))}
                    placeholder="Used in compact contexts"
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supportEmail">Support Email</Label>
                  <Input
                    id="supportEmail"
                    value={brand.supportEmail ?? ''}
                    onChange={(e) => setBrand((b) => ({ ...b, supportEmail: e.target.value }))}
                    placeholder="support@brand.com"
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="legalEmail">Legal Email</Label>
                  <Input
                    id="legalEmail"
                    value={brand.legalEmail ?? ''}
                    onChange={(e) => setBrand((b) => ({ ...b, legalEmail: e.target.value }))}
                    placeholder="legal@brand.com"
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="primaryHsl">Primary (HSL)</Label>
                  <Input
                    id="primaryHsl"
                    value={brand.primaryHsl ?? ''}
                    onChange={(e) => setBrand((b) => ({ ...b, primaryHsl: e.target.value }))}
                    placeholder="e.g., 24.6 95% 53.1%"
                    className="bg-white/5 border-white/10 font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="primaryForegroundHsl">Primary Foreground (HSL)</Label>
                  <Input
                    id="primaryForegroundHsl"
                    value={brand.primaryForegroundHsl ?? ''}
                    onChange={(e) => setBrand((b) => ({ ...b, primaryForegroundHsl: e.target.value }))}
                    placeholder="e.g., 60 9.1% 97.8%"
                    className="bg-white/5 border-white/10 font-mono"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="logoUrl">Logo URL</Label>
                  <Input
                    id="logoUrl"
                    value={brand.logoUrl ?? ''}
                    onChange={(e) => setBrand((b) => ({ ...b, logoUrl: e.target.value }))}
                    placeholder="https://..."
                    className="bg-white/5 border-white/10"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="submit" className="bg-campfire-500 hover:bg-campfire-600" disabled={isSaving}>
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? 'Creating…' : 'Create Tenant'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

