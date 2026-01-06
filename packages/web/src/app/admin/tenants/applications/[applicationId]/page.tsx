'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, FileText, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  approveTenantApplication,
  getTenantApplication,
  rejectTenantApplication,
  type TenantApplication,
  type TenantApplicationBrandConfig,
  type TenantApplicationStatus,
} from '@/lib/api/tenant-applications';

function statusBadge(status: TenantApplicationStatus) {
  if (status === 'approved') {
    return <Badge className="bg-green-500/20 text-green-500 hover:bg-green-500/30">Approved</Badge>;
  }
  if (status === 'rejected') {
    return <Badge className="bg-red-500/20 text-red-500 hover:bg-red-500/30">Rejected</Badge>;
  }
  return <Badge className="bg-amber-500/20 text-amber-400 hover:bg-amber-500/30">Submitted</Badge>;
}

export default function AdminTenantApplicationDetailPage() {
  const params = useParams();
  const applicationId = params.applicationId as string;
  const router = useRouter();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [application, setApplication] = useState<TenantApplication | null>(null);

  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  const [ownerUserId, setOwnerUserId] = useState('');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [primaryDomain, setPrimaryDomain] = useState('');
  const [markDomainVerified, setMarkDomainVerified] = useState(false);
  const [decisionReason, setDecisionReason] = useState('');

  const [includeBrand, setIncludeBrand] = useState(true);
  const [brand, setBrand] = useState<TenantApplicationBrandConfig>({
    name: '',
    shortName: '',
    supportEmail: '',
    legalEmail: '',
    primaryHsl: '',
    primaryForegroundHsl: '',
    logoUrl: '',
  });

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await getTenantApplication(applicationId);
      setApplication(res.data.application);

      // Set defaults for the approve form only on first load.
      setOwnerUserId((prev) => prev || res.data.application.applicantUserId || '');
      setSlug((prev) => prev || res.data.application.desiredSlug);
      setName((prev) => prev || res.data.application.desiredTenantName);
      setPrimaryDomain((prev) => prev || res.data.application.desiredPrimaryDomain || '');
      setBrand((prev) => (Object.values(prev).some((v) => (v ?? '').toString().trim() !== '') ? prev : res.data.application.brandConfig));
      setIncludeBrand((prev) => (prev ? prev : Object.values(res.data.application.brandConfig ?? {}).some((v) => (v ?? '').toString().trim() !== '')));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load application');
    } finally {
      setIsLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const approveDisabled = useMemo(() => {
    if (!application) return true;
    if (application.status !== 'submitted') return true;
    if (!ownerUserId.trim()) return true;
    return false;
  }, [application, ownerUserId]);

  const approve = async () => {
    if (!application) return;
    setIsApproving(true);
    setError(null);

    try {
      const brandConfig = includeBrand
        ? (Object.fromEntries(
          Object.entries(brand ?? {}).filter(([, v]) => (v ?? '').toString().trim() !== '')
        ) as TenantApplicationBrandConfig)
        : undefined;

      const res = await approveTenantApplication(application.id, {
        ownerUserId,
        slug: slug.trim() ? slug : undefined,
        name: name.trim() ? name : undefined,
        primaryDomain: primaryDomain.trim() ? primaryDomain : undefined,
        markDomainVerified,
        brandConfig,
        decisionReason: decisionReason.trim() ? decisionReason : undefined,
      });

      toast({ title: 'Approved', description: 'Tenant created successfully.' });
      router.push(`/admin/tenants/${res.data.tenant.id}` as Route);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to approve application';
      setError(msg);
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setIsApproving(false);
    }
  };

  const reject = async () => {
    if (!application) return;
    setIsRejecting(true);
    setError(null);

    try {
      await rejectTenantApplication(application.id, { decisionReason: decisionReason.trim() ? decisionReason : undefined });
      toast({ title: 'Rejected', description: 'Application rejected.' });
      await fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reject application';
      setError(msg);
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={'/admin/tenants/applications' as Route}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileText className="h-5 w-5 text-campfire-500" />
            Application
          </h1>
          <p className="text-gray-400 text-sm truncate">{applicationId}</p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {isLoading || !application ? (
        <div className="text-gray-400 text-sm">Loading application…</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Card className="bg-white/[0.02] border-white/5">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-white">Summary</CardTitle>
                {statusBadge(application.status)}
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <div className="text-xs text-gray-500">Desired tenant</div>
                  <div className="text-white font-medium">{application.desiredTenantName}</div>
                  <div className="text-gray-400">
                    <span className="font-mono">/{application.desiredSlug}</span>
                    {application.desiredPrimaryDomain ? (
                      <>
                        {' '}
                        • <span className="font-mono">{application.desiredPrimaryDomain}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-xs text-gray-500">Applicant</div>
                    <div className="text-white">{application.applicantName}</div>
                    <div className="text-gray-400 font-mono text-xs">{application.applicantEmail}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Applicant user ID</div>
                    <div className="text-gray-300 font-mono text-xs">{application.applicantUserId ?? '—'}</div>
                  </div>
                </div>
                {application.message ? (
                  <div>
                    <div className="text-xs text-gray-500">Message</div>
                    <div className="text-gray-300 whitespace-pre-wrap">{application.message}</div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="bg-white/[0.02] border-white/5">
              <CardHeader>
                <CardTitle className="text-white">Brand config</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-gray-400">
                <pre className="text-xs whitespace-pre-wrap break-words bg-black/40 border border-white/5 rounded-lg p-3">
                  {JSON.stringify(application.brandConfig ?? {}, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-white/[0.02] border-white/5 h-fit">
            <CardHeader>
              <CardTitle className="text-white">Decision</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {application.status !== 'submitted' && (
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/5 text-gray-300 text-sm">
                  This application has already been {application.status}.
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ownerUserId">Owner user ID</Label>
                  <Input
                    id="ownerUserId"
                    value={ownerUserId}
                    onChange={(e) => setOwnerUserId(e.target.value)}
                    placeholder="UUID of tenant owner"
                    className="bg-white/5 border-white/10 font-mono"
                    required
                  />
                  <p className="text-xs text-gray-500">Required. Each user can own at most one tenant.</p>
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

                <div className="space-y-2">
                  <Label htmlFor="primaryDomain">Primary domain (optional)</Label>
                  <Input
                    id="primaryDomain"
                    value={primaryDomain}
                    onChange={(e) => setPrimaryDomain(e.target.value)}
                    placeholder="example.com"
                    className="bg-white/5 border-white/10 font-mono"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">Mark domain verified</div>
                    <div className="text-xs text-gray-500">Use only if ownership has been verified.</div>
                  </div>
                  <Switch checked={markDomainVerified} onCheckedChange={setMarkDomainVerified} />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                  <div>
                    <div className="text-white font-medium">Include brand overrides</div>
                    <div className="text-xs text-gray-500">Applies applicant brand config during tenant creation.</div>
                  </div>
                  <Switch checked={includeBrand} onCheckedChange={setIncludeBrand} />
                </div>

                {includeBrand && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="brandName">Brand name</Label>
                      <Input
                        id="brandName"
                        value={brand.name ?? ''}
                        onChange={(e) => setBrand((b) => ({ ...b, name: e.target.value }))}
                        className="bg-white/5 border-white/10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="brandShortName">Short name</Label>
                      <Input
                        id="brandShortName"
                        value={brand.shortName ?? ''}
                        onChange={(e) => setBrand((b) => ({ ...b, shortName: e.target.value }))}
                        className="bg-white/5 border-white/10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="supportEmail">Support email</Label>
                      <Input
                        id="supportEmail"
                        value={brand.supportEmail ?? ''}
                        onChange={(e) => setBrand((b) => ({ ...b, supportEmail: e.target.value }))}
                        className="bg-white/5 border-white/10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="legalEmail">Legal email</Label>
                      <Input
                        id="legalEmail"
                        value={brand.legalEmail ?? ''}
                        onChange={(e) => setBrand((b) => ({ ...b, legalEmail: e.target.value }))}
                        className="bg-white/5 border-white/10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="primaryHsl">Primary HSL</Label>
                      <Input
                        id="primaryHsl"
                        value={brand.primaryHsl ?? ''}
                        onChange={(e) => setBrand((b) => ({ ...b, primaryHsl: e.target.value }))}
                        className="bg-white/5 border-white/10 font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="primaryForegroundHsl">Primary foreground HSL</Label>
                      <Input
                        id="primaryForegroundHsl"
                        value={brand.primaryForegroundHsl ?? ''}
                        onChange={(e) => setBrand((b) => ({ ...b, primaryForegroundHsl: e.target.value }))}
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
                )}

                <div className="space-y-2">
                  <Label htmlFor="decisionReason">Decision reason (optional)</Label>
                  <Textarea
                    id="decisionReason"
                    value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)}
                    placeholder="Internal notes or message to applicant…"
                    className="bg-white/5 border-white/10"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                  onClick={reject}
                  disabled={application.status !== 'submitted' || isRejecting}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  {isRejecting ? 'Rejecting…' : 'Reject'}
                </Button>
                <Button
                  type="button"
                  className="bg-campfire-500 hover:bg-campfire-600"
                  onClick={approve}
                  disabled={approveDisabled || isApproving}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {isApproving ? 'Approving…' : 'Approve & create tenant'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
