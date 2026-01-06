'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowLeft, CheckCircle2, RefreshCw, Save, Star, Store, Trash2, XCircle } from 'lucide-react';
import {
  addTenantDomain,
  deleteTenantDomain,
  getTenant,
  updateTenant,
  updateTenantDomain,
  verifyTenantDomain,
  type AdminTenant,
  type AdminTenantDomain,
  type TenantBrandConfig,
  type TenantStatus,
} from '@/lib/api/tenants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export default function TenantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.tenantId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tenant, setTenant] = useState<AdminTenant | null>(null);
  const [domains, setDomains] = useState<AdminTenantDomain[]>([]);

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [brand, setBrand] = useState<TenantBrandConfig>({});

  const [newDomain, setNewDomain] = useState('');
  const [newDomainPrimary, setNewDomainPrimary] = useState(true);
  const [isAddingDomain, setIsAddingDomain] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await getTenant(tenantId);
      setTenant(res.data.tenant);
      setDomains(res.data.domains);

      setSlug(res.data.tenant.slug);
      setName(res.data.tenant.name);
      setIsActive(res.data.tenant.status === 'active');
      setBrand(res.data.tenant.brandConfig ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenant');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const status: TenantStatus = isActive ? 'active' : 'suspended';

  const primaryDomain = useMemo(() => domains.find(d => d.isPrimary)?.domain ?? null, [domains]);

  const handleSave = async () => {
    if (!tenant) return;
    setError(null);
    setIsSaving(true);

    try {
      const brandConfig: TenantBrandConfig = Object.fromEntries(
        Object.entries(brand ?? {}).filter(([, v]) => (v ?? '').toString().trim() !== '')
      );
      const res = await updateTenant(tenant.id, { slug, name, status, brandConfig });
      setTenant(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddDomain = async () => {
    if (!newDomain.trim()) return;
    setIsAddingDomain(true);
    setError(null);
    try {
      const res = await addTenantDomain(tenantId, { domain: newDomain, isPrimary: newDomainPrimary });
      setDomains((prev) => {
        const next = prev.filter(d => d.id !== res.data.id);
        if (res.data.isPrimary) {
          return [res.data, ...next.map(d => ({ ...d, isPrimary: false }))];
        }
        return [...next, res.data].sort((a, b) => (a.isPrimary === b.isPrimary ? a.domain.localeCompare(b.domain) : a.isPrimary ? -1 : 1));
      });
      setNewDomain('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add domain');
    } finally {
      setIsAddingDomain(false);
    }
  };

  const markPrimary = async (domain: AdminTenantDomain) => {
    setError(null);
    try {
      const res = await updateTenantDomain(tenantId, domain.id, { isPrimary: true });
      setDomains((prev) => prev.map(d => d.id === res.data.id ? res.data : ({ ...d, isPrimary: false })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set primary domain');
    }
  };

  const markVerified = async (domain: AdminTenantDomain) => {
    setError(null);
    try {
      const res = await verifyTenantDomain(tenantId, domain.id);
      setDomains((prev) => prev.map(d => d.id === res.data.id ? res.data : d));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify domain');
    }
  };

  const removeDomain = async (domain: AdminTenantDomain) => {
    setError(null);
    try {
      await deleteTenantDomain(tenantId, domain.id);
      setDomains((prev) => prev.filter(d => d.id !== domain.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete domain');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-gray-400 text-sm">Loading tenant…</div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.push('/admin/tenants' as Route)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="text-red-400 text-sm">Tenant not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href={'/admin/tenants' as Route}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-white truncate">{tenant.name}</h1>
            <p className="text-gray-400 text-sm">
              <span className="font-mono">/{tenant.slug}</span>
              {primaryDomain && (
                <>
                  <span className="mx-2">·</span>
                  <span>Primary: <span className="font-mono">{primaryDomain}</span></span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-white/10"
            onClick={() => {
              setIsRefreshing(true);
              fetchData();
            }}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            className="bg-campfire-500 hover:bg-campfire-600"
            onClick={handleSave}
            disabled={isSaving}
          >
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Store className="h-5 w-5 text-campfire-500" />
              Tenant
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Tenant ID</Label>
              <Input value={tenant.id} readOnly className="bg-white/5 border-white/10 font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Owner User ID</Label>
              <Input value={tenant.ownerUserId} readOnly className="bg-white/5 border-white/10 font-mono" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="bg-white/5 border-white/10 font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-white/5 border-white/10"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="active">Active</Label>
              <Switch id="active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white">Brand</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="brandName">Brand Name</Label>
                <Input
                  id="brandName"
                  value={brand.name ?? ''}
                  onChange={(e) => setBrand((b) => ({ ...b, name: e.target.value }))}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shortName">Short Name</Label>
                <Input
                  id="shortName"
                  value={brand.shortName ?? ''}
                  onChange={(e) => setBrand((b) => ({ ...b, shortName: e.target.value }))}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supportEmail">Support Email</Label>
                <Input
                  id="supportEmail"
                  value={brand.supportEmail ?? ''}
                  onChange={(e) => setBrand((b) => ({ ...b, supportEmail: e.target.value }))}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="legalEmail">Legal Email</Label>
                <Input
                  id="legalEmail"
                  value={brand.legalEmail ?? ''}
                  onChange={(e) => setBrand((b) => ({ ...b, legalEmail: e.target.value }))}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="primaryHsl">Primary (HSL)</Label>
                <Input
                  id="primaryHsl"
                  value={brand.primaryHsl ?? ''}
                  onChange={(e) => setBrand((b) => ({ ...b, primaryHsl: e.target.value }))}
                  placeholder="24.6 95% 53.1%"
                  className="bg-white/5 border-white/10 font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="primaryForegroundHsl">Primary Foreground (HSL)</Label>
                <Input
                  id="primaryForegroundHsl"
                  value={brand.primaryForegroundHsl ?? ''}
                  onChange={(e) => setBrand((b) => ({ ...b, primaryForegroundHsl: e.target.value }))}
                  placeholder="60 9.1% 97.8%"
                  className="bg-white/5 border-white/10 font-mono"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="logoUrl">Logo URL</Label>
                <Input
                  id="logoUrl"
                  value={brand.logoUrl ?? ''}
                  onChange={(e) => setBrand((b) => ({ ...b, logoUrl: e.target.value }))}
                  className="bg-white/5 border-white/10"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-white/10 text-gray-300 hover:bg-white/10">Preview</Badge>
              <div
                className="h-4 w-4 rounded"
                style={{
                  background: brand.primaryHsl ? `hsl(${brand.primaryHsl})` : undefined,
                }}
                aria-label="primary-color-preview"
              />
              <span className="text-xs text-gray-500">Uses `hsl(var(--primary))` tokens.</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-lg text-white">Domains</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="example.com"
              className="w-64 bg-white/5 border-white/10 font-mono"
            />
            <div className="flex items-center gap-2">
              <Label className="text-sm text-gray-400">Primary</Label>
              <Switch checked={newDomainPrimary} onCheckedChange={setNewDomainPrimary} />
            </div>
            <Button
              onClick={handleAddDomain}
              disabled={isAddingDomain || !newDomain.trim()}
              className="bg-campfire-500 hover:bg-campfire-600"
            >
              {isAddingDomain ? 'Adding…' : 'Add Domain'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {domains.length === 0 ? (
            <div className="text-gray-400 text-sm">No domains yet.</div>
          ) : (
            <div className="space-y-2">
              {domains.map((d) => {
                const isVerified = !!d.verifiedAt;
                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-white truncate">{d.domain}</span>
                        {d.isPrimary && (
                          <Badge className="bg-campfire-500/20 text-campfire-400 hover:bg-campfire-500/30">
                            <Star className="h-3 w-3 mr-1" />
                            Primary
                          </Badge>
                        )}
                        {isVerified ? (
                          <Badge className="bg-green-500/20 text-green-500 hover:bg-green-500/30">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge className="bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30">
                            <XCircle className="h-3 w-3 mr-1" />
                            Unverified
                          </Badge>
                        )}
                      </div>
                      {!isVerified && d.verificationToken && (
                        <div className="text-xs text-gray-500 mt-2">
                          Token: <span className="font-mono break-all">{d.verificationToken}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {!d.isPrimary && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-white/10"
                          onClick={() => markPrimary(d)}
                        >
                          Make primary
                        </Button>
                      )}

                      {!isVerified && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-white/10"
                          onClick={() => markVerified(d)}
                        >
                          Mark verified
                        </Button>
                      )}

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-red-400">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-zinc-900 border-white/10">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-white">Remove domain?</AlertDialogTitle>
                            <AlertDialogDescription className="text-gray-400">
                              This will stop routing brand requests for <span className="font-mono">{d.domain}</span>.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-white/5 border-white/10 text-white hover:bg-white/10">
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-red-500 hover:bg-red-600 text-white"
                              onClick={() => removeDomain(d)}
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

