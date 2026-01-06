'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { ArrowRight, FileText, Plus, RefreshCw, Store } from 'lucide-react';
import { listTenants, type AdminTenantListItem } from '@/lib/api/tenants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function AdminTenantsPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tenants, setTenants] = useState<AdminTenantListItem[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await listTenants({ search: search || undefined, limit: 50, offset: 0 });
      setTenants(res.data.tenants);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenants');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statusBadge = (status: string) => {
    if (status === 'active') {
      return <Badge className="bg-green-500/20 text-green-500 hover:bg-green-500/30">Active</Badge>;
    }
    if (status === 'suspended') {
      return <Badge className="bg-red-500/20 text-red-500 hover:bg-red-500/30">Suspended</Badge>;
    }
    return <Badge className="bg-gray-500/20 text-gray-400 hover:bg-gray-500/30">{status}</Badge>;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(t =>
      t.slug.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      (t.primaryDomain ?? '').toLowerCase().includes(q)
    );
  }, [tenants, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tenants</h1>
          <p className="text-gray-400 text-sm">Manage white-label tenants and domains</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={'/admin/tenants/applications' as Route}>
            <Button variant="outline" className="border-white/10 hover:bg-white/10">
              <FileText className="h-4 w-4 mr-2" />
              Applications
            </Button>
          </Link>
          <Link href={'/admin/tenants/new' as Route}>
            <Button className="bg-campfire-500 hover:bg-campfire-600">
              <Plus className="h-4 w-4 mr-2" />
              Add Tenant
            </Button>
          </Link>
        </div>
      </div>

      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Store className="h-5 w-5 text-campfire-500" />
            Tenants
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by slug, name, domain..."
              className="w-64 bg-white/5 border-white/10"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsRefreshing(true);
                fetchData();
              }}
              disabled={isRefreshing}
              className="border-white/10"
            >
              <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="text-gray-400 text-sm">Loading tenants…</div>
          ) : filtered.length === 0 ? (
            <div className="text-gray-400 text-sm">No tenants found.</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => router.push(`/admin/tenants/${t.id}` as Route)}
                  className="w-full flex items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 transition-colors text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="font-medium text-white truncate">{t.name}</div>
                      {statusBadge(t.status)}
                      <Badge className="bg-white/10 text-gray-300 hover:bg-white/10">
                        {t.domainCount} domain{t.domainCount === 1 ? '' : 's'}
                      </Badge>
                    </div>
                    <div className="text-sm text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <span className="font-mono text-xs">/{t.slug}</span>
                      {t.primaryDomain && (
                        <span className="text-xs">
                          Primary: <span className="font-mono">{t.primaryDomain}</span>
                        </span>
                      )}
                      <span className="text-xs">
                        Owner: <span className="font-mono">{t.ownerUserId}</span>
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-gray-500 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
