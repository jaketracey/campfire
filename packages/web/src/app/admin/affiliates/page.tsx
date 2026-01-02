'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { formatDistanceToNow } from 'date-fns';
import { Search, RefreshCw, ChevronLeft, ChevronRight, Plus, Copy, Check, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  listAffiliates,
  type AffiliateListItem,
  type AffiliateStatus,
} from '@/lib/api/affiliates';

const PAGE_SIZE = 20;

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

  return (
    <Badge variant="outline" className={variant.className}>
      {variant.label}
    </Badge>
  );
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/ref/${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-6 px-2 text-gray-400 hover:text-white"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function AffiliatesTable({ affiliates, onRefresh }: { affiliates: AffiliateListItem[]; onRefresh: () => void }) {
  if (affiliates.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No affiliates found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/5">
            <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Affiliate
            </th>
            <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Code
            </th>
            <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="text-center py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Clicks
            </th>
            <th className="text-center py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Conversions
            </th>
            <th className="text-right py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Pending
            </th>
            <th className="text-right py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Total Earned
            </th>
            <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Last Login
            </th>
            <th className="text-right py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {affiliates.map((affiliate) => (
            <tr
              key={affiliate.id}
              className="hover:bg-white/[0.02] transition-colors"
            >
              <td className="py-4 px-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-campfire-500/10 text-campfire-500 font-medium">
                      {affiliate.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium text-white">{affiliate.name}</p>
                    <p className="text-xs text-gray-500">{affiliate.email}</p>
                  </div>
                </div>
              </td>
              <td className="py-4 px-4">
                <div className="flex items-center gap-1">
                  <code className="text-sm text-campfire-400 bg-campfire-500/10 px-2 py-0.5 rounded">
                    {affiliate.code}
                  </code>
                  <CopyCodeButton code={affiliate.code} />
                </div>
              </td>
              <td className="py-4 px-4">
                <StatusBadge status={affiliate.status} />
              </td>
              <td className="py-4 px-4 text-center">
                <span className="text-white font-medium">{affiliate.totalClicks.toLocaleString()}</span>
              </td>
              <td className="py-4 px-4 text-center">
                <span className="text-white font-medium">{affiliate.totalConversions}</span>
                {affiliate.pendingConversions > 0 && (
                  <span className="text-yellow-500 text-xs ml-1">
                    (+{affiliate.pendingConversions})
                  </span>
                )}
              </td>
              <td className="py-4 px-4 text-right">
                {affiliate.pendingEarnings > 0 ? (
                  <span className="text-yellow-400 font-medium">
                    {formatCurrency(affiliate.pendingEarnings)}
                  </span>
                ) : (
                  <span className="text-gray-500">-</span>
                )}
              </td>
              <td className="py-4 px-4 text-right">
                <span className="text-white font-medium">
                  {formatCurrency(affiliate.totalEarned)}
                </span>
                {affiliate.totalPaid > 0 && (
                  <p className="text-xs text-gray-500">
                    Paid: {formatCurrency(affiliate.totalPaid)}
                  </p>
                )}
              </td>
              <td className="py-4 px-4">
                {affiliate.lastLoginAt ? (
                  <span className="text-gray-400 text-sm">
                    {formatDistanceToNow(new Date(affiliate.lastLoginAt), { addSuffix: true })}
                  </span>
                ) : (
                  <span className="text-gray-600 text-sm">Never</span>
                )}
              </td>
              <td className="py-4 px-4 text-right">
                <Link href={`/admin/affiliates/${affiliate.id}` as Route}>
                  <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminAffiliatesPage() {
  const [affiliates, setAffiliates] = useState<AffiliateListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AffiliateStatus | 'all'>('all');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchAffiliates = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await listAffiliates({
        limit: PAGE_SIZE,
        offset,
        search: debouncedSearch || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
      });
      setAffiliates(response.data.affiliates);
      setHasMore(response.data.hasMore);
      setTotal(response.data.total);
    } catch (error) {
      console.error('Failed to fetch affiliates:', error);
    } finally {
      setIsLoading(false);
    }
  }, [offset, debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchAffiliates();
  }, [fetchAffiliates]);

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - PAGE_SIZE));
  };

  const handleNextPage = () => {
    if (hasMore) {
      setOffset(offset + PAGE_SIZE);
    }
  };

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Calculate summary stats
  const totalPending = affiliates.reduce((sum, a) => sum + a.pendingEarnings, 0);
  const pendingConversions = affiliates.reduce((sum, a) => sum + a.pendingConversions, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-white">Affiliates</h1>
          <p className="text-gray-400 mt-1">Manage affiliate partners and commissions</p>
        </div>
        <div className="flex items-center gap-3">
          {pendingConversions > 0 && (
            <Link href={'/admin/affiliates/payouts' as Route}>
              <Button variant="outline" className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10">
                {pendingConversions} pending ({formatCurrency(totalPending)})
              </Button>
            </Link>
          )}
          <Link href={'/admin/affiliates/new' as Route}>
            <Button className="bg-campfire-500 hover:bg-campfire-600">
              <Plus className="h-4 w-4 mr-2" />
              Add Affiliate
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Card */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="border-b border-white/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Search */}
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, or code..."
                className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-gray-600"
              />
            </div>

            <div className="flex items-center gap-3">
              {/* Status Filter */}
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as AffiliateStatus | 'all');
                  setOffset(0);
                }}
              >
                <SelectTrigger className="w-32 bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>

              {/* Refresh */}
              <Button
                variant="outline"
                size="icon"
                onClick={fetchAffiliates}
                disabled={isLoading}
                className="border-white/10 hover:bg-white/10"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-pulse text-gray-500">Loading affiliates...</div>
            </div>
          ) : (
            <AffiliatesTable affiliates={affiliates} onRefresh={fetchAffiliates} />
          )}
        </CardContent>

        {/* Pagination */}
        {!isLoading && affiliates.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
            <p className="text-sm text-gray-500">
              Page {currentPage} &middot; Showing {affiliates.length} of {total} affiliates
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevPage}
                disabled={offset === 0}
                className="border-white/10 hover:bg-white/10"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={!hasMore}
                className="border-white/10 hover:bg-white/10"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
