'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getAffiliateToken } from '@/stores/affiliate-auth-store';
import {
  getAffiliateConversions,
  type AffiliateConversion,
  type ConversionStatus,
} from '@/lib/api/affiliates';

const PAGE_SIZE = 20;

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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

function PlanBadge({ tier }: { tier: 'standard' | 'premium' }) {
  return (
    <Badge
      variant="outline"
      className={
        tier === 'premium'
          ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
          : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
      }
    >
      {tier === 'premium' ? 'Premium' : 'Standard'}
    </Badge>
  );
}

export default function AffiliateConversionsPage() {
  const [conversions, setConversions] = useState<AffiliateConversion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ConversionStatus | 'all'>('all');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const fetchConversions = useCallback(async () => {
    const token = getAffiliateToken();
    if (!token) return;

    setIsLoading(true);
    try {
      const response = await getAffiliateConversions(token, {
        status: statusFilter !== 'all' ? statusFilter : undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setConversions(response.data.conversions || []);
      setHasMore(response.data.hasMore);
    } catch (error) {
      console.error('Failed to fetch conversions:', error);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, offset]);

  useEffect(() => {
    fetchConversions();
  }, [fetchConversions]);

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - PAGE_SIZE));
  };

  const handleNextPage = () => {
    if (hasMore) {
      setOffset(offset + PAGE_SIZE);
    }
  };

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Calculate totals from visible conversions
  const totalEarnings = conversions.reduce((sum, c) => {
    return c.status === 'paid' ? sum + c.commissionAmount : sum;
  }, 0);
  const pendingEarnings = conversions.reduce((sum, c) => {
    return c.status === 'pending' || c.status === 'approved' ? sum + c.commissionAmount : sum;
  }, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold font-display text-white">Conversions</h1>
        <p className="text-gray-400 mt-1">Track your referral conversions and earnings</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-green-500/5 border-green-500/20">
          <CardContent className="py-4">
            <p className="text-sm text-green-400">Paid Earnings (this page)</p>
            <p className="text-2xl font-bold text-white">{formatCurrency(totalEarnings)}</p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-500/5 border-yellow-500/20">
          <CardContent className="py-4">
            <p className="text-sm text-yellow-400">Pending Earnings (this page)</p>
            <p className="text-2xl font-bold text-white">{formatCurrency(pendingEarnings)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Table */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="border-b border-white/5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg text-white">All Conversions</CardTitle>
            <div className="flex items-center gap-3">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as ConversionStatus | 'all');
                  setOffset(0);
                }}
              >
                <SelectTrigger className="w-32 bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={fetchConversions}
                disabled={isLoading}
                className="border-white/10"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-pulse text-gray-500">Loading conversions...</div>
            </div>
          ) : conversions.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No conversions found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Plan
                    </th>
                    <th className="text-right py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Commission
                    </th>
                    <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Paid At
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {conversions.map((conv) => (
                    <tr key={conv.id} className="hover:bg-white/[0.02]">
                      <td className="py-4 px-4">
                        <p className="text-sm text-white">
                          {format(new Date(conv.createdAt), 'MMM d, yyyy')}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDistanceToNow(new Date(conv.createdAt), { addSuffix: true })}
                        </p>
                      </td>
                      <td className="py-4 px-4">
                        <PlanBadge tier={conv.planTier} />
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-white font-medium">
                          {formatCurrency(conv.commissionAmount)}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <ConversionStatusBadge status={conv.status} />
                        {conv.rejectionReason && (
                          <p className="text-xs text-red-400 mt-1">{conv.rejectionReason}</p>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {conv.paidAt ? (
                          <span className="text-sm text-gray-400">
                            {format(new Date(conv.paidAt), 'MMM d, yyyy')}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-600">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>

        {/* Pagination */}
        {!isLoading && conversions.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
            <p className="text-sm text-gray-500">
              Page {currentPage} &middot; Showing {conversions.length} conversions
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
