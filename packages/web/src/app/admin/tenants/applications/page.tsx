'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import Link from 'next/link';
import { ArrowRight, FileText, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { listTenantApplications, type TenantApplication, type TenantApplicationStatus } from '@/lib/api/tenant-applications';

function statusBadge(status: TenantApplicationStatus) {
  if (status === 'approved') {
    return <Badge className="bg-green-500/20 text-green-500 hover:bg-green-500/30">Approved</Badge>;
  }
  if (status === 'rejected') {
    return <Badge className="bg-red-500/20 text-red-500 hover:bg-red-500/30">Rejected</Badge>;
  }
  return <Badge className="bg-amber-500/20 text-amber-400 hover:bg-amber-500/30">Submitted</Badge>;
}

export default function AdminTenantApplicationsPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TenantApplicationStatus | 'all'>('all');
  const [applications, setApplications] = useState<TenantApplication[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await listTenantApplications({
        limit: 50,
        offset: 0,
        search: search || undefined,
        status: status === 'all' ? undefined : status,
      });
      setApplications(res.data.applications);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load applications');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [search, status]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter((a) =>
      a.applicantName.toLowerCase().includes(q) ||
      a.applicantEmail.toLowerCase().includes(q) ||
      a.desiredTenantName.toLowerCase().includes(q) ||
      a.desiredSlug.toLowerCase().includes(q) ||
      (a.desiredPrimaryDomain ?? '').toLowerCase().includes(q)
    );
  }, [applications, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tenant applications</h1>
          <p className="text-gray-400 text-sm">Review and onboard new tenants</p>
        </div>
        <Link href={'/admin/tenants' as Route}>
          <Button variant="outline" className="border-white/10 hover:bg-white/10">
            Back to tenants
          </Button>
        </Link>
      </div>

      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <FileText className="h-5 w-5 text-campfire-500" />
            Applications
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
              {(['all', 'submitted', 'approved', 'rejected'] as const).map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant={status === s ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setStatus(s)}
                  className={cn(
                    'h-8',
                    status === s
                      ? 'bg-campfire-500 hover:bg-campfire-600 text-white'
                      : 'text-gray-300 hover:bg-white/10'
                  )}
                >
                  {s === 'all' ? 'All' : s === 'submitted' ? 'Submitted' : s[0].toUpperCase() + s.slice(1)}
                </Button>
              ))}
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search applicants, slug, domain..."
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
            <div className="text-gray-400 text-sm">Loading applications…</div>
          ) : filtered.length === 0 ? (
            <div className="text-gray-400 text-sm">No applications found.</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => router.push(`/admin/tenants/applications/${a.id}` as Route)}
                  className="w-full flex items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 transition-colors text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="font-medium text-white truncate">{a.desiredTenantName}</div>
                      {statusBadge(a.status)}
                      <Badge className="bg-white/10 text-gray-300 hover:bg-white/10">
                        <span className="font-mono text-xs">/{a.desiredSlug}</span>
                      </Badge>
                      {a.desiredPrimaryDomain && (
                        <Badge className="bg-white/10 text-gray-300 hover:bg-white/10">
                          <span className="font-mono text-xs">{a.desiredPrimaryDomain}</span>
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <span className="text-xs">
                        Applicant: <span className="font-mono">{a.applicantEmail}</span>
                      </span>
                      <span className="text-xs">
                        ID: <span className="font-mono">{a.id}</span>
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

