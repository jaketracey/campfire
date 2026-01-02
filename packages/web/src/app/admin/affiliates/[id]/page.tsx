'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { formatDistanceToNow } from 'date-fns';
import {
  Handshake,
  ArrowLeft,
  Save,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  getAffiliate,
  updateAffiliate,
  deactivateAffiliate,
  getAffiliateConversionsAdmin,
  type AffiliateDetail,
  type AffiliateConversion,
  type AffiliateStatus,
  type ConversionStatus,
} from '@/lib/api/affiliates';

const PAGE_SIZE = 10;

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function StatusBadge({ status }: { status: AffiliateStatus }) {
  const variants: Record<AffiliateStatus, { label: string; className: string }> = {
    active: { label: 'Active', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
    suspended: { label: 'Suspended', className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
    inactive: { label: 'Inactive', className: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  };

  const variant = variants[status];
  return <Badge variant="outline" className={variant.className}>{variant.label}</Badge>;
}

function ConversionStatusBadge({ status }: { status: ConversionStatus }) {
  const variants: Record<ConversionStatus, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
    approved: { label: 'Approved', className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
    paid: { label: 'Paid', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
    rejected: { label: 'Rejected', className: 'bg-red-500/10 text-red-500 border-red-500/20' },
  };

  const variant = variants[status];
  return <Badge variant="outline" className={variant.className}>{variant.label}</Badge>;
}

export default function AffiliateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const affiliateId = params.id as string;

  const [affiliate, setAffiliate] = useState<AffiliateDetail | null>(null);
  const [conversions, setConversions] = useState<AffiliateConversion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<AffiliateStatus>('active');
  const [commissionStandard, setCommissionStandard] = useState<number | ''>(0);
  const [commissionPremium, setCommissionPremium] = useState<number | ''>(0);
  const [notes, setNotes] = useState('');

  // Conversions pagination
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const fetchAffiliate = useCallback(async () => {
    try {
      const response = await getAffiliate(affiliateId);
      const data = response.data;
      setAffiliate(data);
      setName(data.name);
      setEmail(data.email);
      setCode(data.code);
      setStatus(data.status);
      setCommissionStandard(data.commissionStandard);
      setCommissionPremium(data.commissionPremium);
      setNotes(data.notes || '');
    } catch (err) {
      console.error('Failed to fetch affiliate:', err);
      setError('Failed to load affiliate');
    }
  }, [affiliateId]);

  const fetchConversions = useCallback(async () => {
    try {
      const response = await getAffiliateConversionsAdmin(affiliateId, {
        limit: PAGE_SIZE,
        offset,
      });
      setConversions(response.data.conversions || []);
      setHasMore(response.data.hasMore);
    } catch (err) {
      console.error('Failed to fetch conversions:', err);
    }
  }, [affiliateId, offset]);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      await Promise.all([fetchAffiliate(), fetchConversions()]);
      setIsLoading(false);
    };
    fetchData();
  }, [fetchAffiliate, fetchConversions]);

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/ref/${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);

    try {
      await updateAffiliate(affiliateId, {
        name,
        email,
        password: password || undefined,
        code,
        status,
        commissionStandard: commissionStandard === '' ? undefined : commissionStandard,
        commissionPremium: commissionPremium === '' ? undefined : commissionPremium,
        notes: notes || undefined,
      });
      await fetchAffiliate();
      setPassword('');
    } catch (err) {
      console.error('Failed to update affiliate:', err);
      setError(err instanceof Error ? err.message : 'Failed to update affiliate');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = async () => {
    setIsDeactivating(true);
    try {
      await deactivateAffiliate(affiliateId);
      router.push('/admin/affiliates' as Route);
    } catch (err) {
      console.error('Failed to deactivate affiliate:', err);
      setError(err instanceof Error ? err.message : 'Failed to deactivate affiliate');
    } finally {
      setIsDeactivating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-pulse text-gray-500">Loading affiliate...</div>
      </div>
    );
  }

  if (!affiliate) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Affiliate not found</p>
        <Link href={'/admin/affiliates' as Route}>
          <Button variant="ghost" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Affiliates
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={'/admin/affiliates' as Route}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{affiliate.name}</h1>
              <StatusBadge status={affiliate.status} />
            </div>
            <p className="text-gray-400 text-sm">{affiliate.email}</p>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={affiliate.status === 'inactive'}>
              <AlertTriangle className="h-4 w-4 mr-2" />
              Deactivate
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deactivate Affiliate</AlertDialogTitle>
              <AlertDialogDescription>
                This will deactivate {affiliate.name}'s affiliate account. They will no longer be able to login or earn commissions. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeactivate}
                disabled={isDeactivating}
                className="bg-red-600 hover:bg-red-700"
              >
                {isDeactivating ? 'Deactivating...' : 'Deactivate'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Clicks</p>
            <p className="text-2xl font-bold text-white mt-1">{affiliate.totalClicks.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Conversions</p>
            <p className="text-2xl font-bold text-white mt-1">
              {affiliate.totalConversions}
              {affiliate.pendingConversions > 0 && (
                <span className="text-yellow-500 text-sm ml-1">(+{affiliate.pendingConversions})</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Pending</p>
            <p className="text-2xl font-bold text-yellow-400 mt-1">{formatCurrency(affiliate.pendingEarnings)}</p>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Paid</p>
            <p className="text-2xl font-bold text-green-400 mt-1">{formatCurrency(affiliate.totalPaid)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Edit Form */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Handshake className="h-5 w-5 text-campfire-500" />
              Affiliate Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label>Referral Link</Label>
              <div className="flex gap-2">
                <Input
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}/ref/${code}`}
                  readOnly
                  className="bg-white/5 border-white/10 text-gray-400"
                />
                <Button variant="outline" onClick={handleCopyLink}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-white/5 border-white/10"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Affiliate Code</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as AffiliateStatus)}>
                  <SelectTrigger className="bg-white/5 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">New Password (leave blank to keep current)</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="bg-white/5 border-white/10 pr-10"
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="commissionStandard">Standard Commission</Label>
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
                    className="bg-white/5 border-white/10 pl-7"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="commissionPremium">Premium Commission</Label>
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
                    className="bg-white/5 border-white/10 pl-7"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Internal Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="bg-white/5 border-white/10 min-h-[80px]"
              />
            </div>

            <div className="flex justify-end pt-4">
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="gap-2 bg-campfire-600 hover:bg-campfire-700"
              >
                <Save className="h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Conversions */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg text-white">Recent Conversions</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchConversions}
              className="text-gray-400 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {conversions.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No conversions yet</p>
            ) : (
              <div className="space-y-3">
                {conversions.map((conv) => (
                  <div
                    key={conv.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5"
                  >
                    <div>
                      <p className="text-sm text-white">
                        {conv.userEmail || conv.userId.slice(0, 8)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {conv.planTier === 'premium' ? 'Premium' : 'Standard'} &middot;{' '}
                        {formatDistanceToNow(new Date(conv.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-white">
                        {formatCurrency(conv.commissionAmount)}
                      </span>
                      <ConversionStatusBadge status={conv.status} />
                    </div>
                  </div>
                ))}

                {/* Pagination */}
                <div className="flex items-center justify-between pt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    disabled={offset === 0}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    disabled={!hasMore}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
