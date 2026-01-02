'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { MousePointer, Users, DollarSign, TrendingUp, Copy, Check, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useAffiliateAuthStore, getAffiliateToken } from '@/stores/affiliate-auth-store';
import {
  getAffiliateStats,
  getAffiliateLink,
  getAffiliateConversions,
  type AffiliateStats,
  type AffiliateLink,
  type AffiliateConversion,
  type ConversionStatus,
} from '@/lib/api/affiliates';

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

export default function AffiliateDashboardPage() {
  const { affiliate } = useAffiliateAuthStore();
  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [link, setLink] = useState<AffiliateLink | null>(null);
  const [recentConversions, setRecentConversions] = useState<AffiliateConversion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async () => {
    const token = getAffiliateToken();
    if (!token) return;

    try {
      const [statsResponse, linkResponse, conversionsResponse] = await Promise.all([
        getAffiliateStats(token),
        getAffiliateLink(token),
        getAffiliateConversions(token, { limit: 5 }),
      ]);

      setStats(statsResponse.data);
      setLink(linkResponse.data);
      setRecentConversions(conversionsResponse.data.conversions || []);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCopyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-pulse text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold font-display text-white">
          Welcome back, {affiliate?.name?.split(' ')[0]}
        </h1>
        <p className="text-gray-400 mt-1">
          Here's an overview of your affiliate performance
        </p>
      </div>

      {/* Referral Link */}
      {link && (
        <Card className="bg-campfire-500/5 border-campfire-500/20">
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-sm text-campfire-400 mb-2">Your Referral Link</p>
                <div className="flex gap-2">
                  <Input
                    value={link.url}
                    readOnly
                    className="bg-white/5 border-white/10 text-white font-mono text-sm"
                  />
                  <Button onClick={handleCopyLink} variant="outline" className="shrink-0">
                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
              </div>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-campfire-400 hover:text-campfire-300 text-sm"
              >
                <ExternalLink className="h-4 w-4" />
                Preview
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-white/[0.02] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <MousePointer className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Clicks</p>
                  <p className="text-2xl font-bold text-white">{stats.totalClicks.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/[0.02] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Users className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Conversions</p>
                  <p className="text-2xl font-bold text-white">{stats.totalConversions}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/[0.02] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-yellow-500/10">
                  <DollarSign className="h-5 w-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Pending</p>
                  <p className="text-2xl font-bold text-yellow-400">{formatCurrency(stats.pendingEarnings)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/[0.02] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Total Paid</p>
                  <p className="text-2xl font-bold text-green-400">{formatCurrency(stats.totalPaid)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Conversion Rate & Recent Conversions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Conversion Rate Card */}
        {stats && (
          <Card className="bg-white/[0.02] border-white/5">
            <CardHeader>
              <CardTitle className="text-lg text-white">Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-500">Conversion Rate</p>
                  <p className="text-3xl font-bold text-white">
                    {stats.totalClicks > 0
                      ? ((stats.totalConversions / stats.totalClicks) * 100).toFixed(1)
                      : '0.0'}
                    %
                  </p>
                </div>
                <div className="pt-4 border-t border-white/5">
                  <p className="text-sm text-gray-500">Total Earned</p>
                  <p className="text-2xl font-bold text-campfire-400">
                    {formatCurrency(stats.totalEarned)}
                  </p>
                </div>
                {stats.pendingConversions > 0 && (
                  <p className="text-xs text-yellow-400">
                    {stats.pendingConversions} conversion{stats.pendingConversions !== 1 ? 's' : ''} pending review
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Conversions */}
        <Card className="bg-white/[0.02] border-white/5 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg text-white">Recent Conversions</CardTitle>
            <a href="/affiliate/conversions" className="text-sm text-campfire-400 hover:underline">
              View all
            </a>
          </CardHeader>
          <CardContent>
            {recentConversions.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No conversions yet. Share your referral link to get started!
              </p>
            ) : (
              <div className="space-y-3">
                {recentConversions.map((conv) => (
                  <div
                    key={conv.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5"
                  >
                    <div>
                      <p className="text-sm text-white">
                        {conv.planTier === 'premium' ? 'Premium' : 'Standard'} Plan
                      </p>
                      <p className="text-xs text-gray-500">
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
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
