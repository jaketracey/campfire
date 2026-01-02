'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  DollarSign,
  Users,
  TrendingUp,
  TrendingDown,
  CreditCard,
  Coins,
  PieChart,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getRevenueSummary, type RevenueSummary } from '@/lib/api/analytics';

interface RevenueTabProps {
  days: number;
  refreshKey: number;
}

export function RevenueTab({ days, refreshKey }: RevenueTabProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await getRevenueSummary(days);
      setSummary(res.data);
    } catch (error) {
      console.error('Failed to fetch revenue data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const formatCurrency = (cents: number) => {
    const dollars = cents / 100;
    if (dollars === 0) return '$0';
    if (dollars < 1) return `$${dollars.toFixed(2)}`;
    if (dollars < 1000) return `$${dollars.toFixed(2)}`;
    if (dollars < 1000000) return `$${(dollars / 1000).toFixed(1)}K`;
    return `$${(dollars / 1000000).toFixed(1)}M`;
  };

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  // Calculate MRR trend direction
  const calculateMrrTrend = () => {
    if (!summary?.trends || summary.trends.length < 2) return null;
    const recent = summary.trends.slice(-7);
    const older = summary.trends.slice(-14, -7);
    if (older.length === 0) return null;

    const recentAvg = recent.reduce((sum, t) => sum + t.mrrCents, 0) / recent.length;
    const olderAvg = older.reduce((sum, t) => sum + t.mrrCents, 0) / older.length;
    const change = ((recentAvg - olderAvg) / (olderAvg || 1)) * 100;

    return { direction: change > 0 ? 'up' : 'down', percent: Math.abs(change) };
  };

  const mrrTrend = calculateMrrTrend();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="bg-white/[0.02] border-white/5">
              <CardContent className="p-6">
                <div className="animate-pulse h-20 bg-white/5 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const tierDistribution = summary?.tierDistribution;
  const tierTotal = tierDistribution
    ? tierDistribution.free + tierDistribution.starter + tierDistribution.pro + tierDistribution.enterprise
    : 0;

  const tiers = tierDistribution
    ? [
        { name: 'Free', count: tierDistribution.free, color: 'bg-gray-500' },
        { name: 'Starter', count: tierDistribution.starter, color: 'bg-blue-500' },
        { name: 'Pro', count: tierDistribution.pro, color: 'bg-purple-500' },
        { name: 'Enterprise', count: tierDistribution.enterprise, color: 'bg-amber-500' },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Key Revenue Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        {/* MRR */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">MRR</p>
                  <p className="text-2xl font-semibold text-white">
                    {summary ? formatCurrency(summary.current.mrrCents) : '-'}
                  </p>
                </div>
              </div>
              {mrrTrend && (
                <div
                  className={cn(
                    'flex items-center gap-1 text-sm',
                    mrrTrend.direction === 'up' ? 'text-green-400' : 'text-red-400'
                  )}
                >
                  {mrrTrend.direction === 'up' ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {mrrTrend.percent.toFixed(0)}%
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ARPU */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">ARPU</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? formatCurrency(summary.current.arpuCents) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subscribers */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Subscribers</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? formatNumber(summary.current.subscriberCount) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Token Revenue */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                <Coins className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Token Revenue</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? formatCurrency(summary.tokens.purchaseRevenueCents) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* MRR Trend Chart */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-campfire-500" />
            MRR Trend ({days} Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-32 flex items-end gap-1">
            {!summary?.trends || summary.trends.length === 0 ? (
              <p className="text-gray-500 text-center w-full py-8">No revenue data available yet.</p>
            ) : (
              summary.trends.map((point) => {
                const max = Math.max(...summary.trends.map((p) => p.mrrCents), 1);
                const height = (point.mrrCents / max) * 100;
                return (
                  <div
                    key={point.date}
                    className="flex-1 group relative"
                    title={`${point.date}: ${formatCurrency(point.mrrCents)}`}
                  >
                    <div
                      className="w-full bg-green-500/60 hover:bg-green-500 transition-colors rounded-t cursor-pointer"
                      style={{ height: `${Math.max(height, 2)}%` }}
                    />
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {point.date}: {formatCurrency(point.mrrCents)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {summary?.trends && summary.trends.length > 0 && (
            <div className="flex justify-between mt-2 text-xs text-gray-500">
              <span>{summary.trends[0]?.date}</span>
              <span>{summary.trends[summary.trends.length - 1]?.date}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tier Distribution and Token Metrics */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Subscription Tier Distribution */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <PieChart className="h-5 w-5 text-purple-500" />
              Subscription Tiers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tierTotal === 0 ? (
              <p className="text-gray-500 text-center py-8">No subscription data yet.</p>
            ) : (
              <div className="space-y-4">
                {tiers.map((tier) => {
                  const percentage = tierTotal > 0 ? (tier.count / tierTotal) * 100 : 0;
                  return (
                    <div key={tier.name}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-white flex items-center gap-2">
                          <span className={cn('w-3 h-3 rounded-full', tier.color)} />
                          {tier.name}
                        </span>
                        <span className="text-gray-400">
                          {formatNumber(tier.count)} ({percentage.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', tier.color)}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Token Metrics */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-500" />
              Token Economics
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!summary?.tokens ? (
              <p className="text-gray-500 text-center py-8">No token data yet.</p>
            ) : (
              <div className="grid gap-4 grid-cols-2">
                <div className="p-4 rounded-lg bg-white/[0.02]">
                  <p className="text-sm text-gray-400">Purchased</p>
                  <p className="text-xl font-bold text-white">
                    {formatNumber(summary.tokens.totalPurchased)}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-white/[0.02]">
                  <p className="text-sm text-gray-400">Spent</p>
                  <p className="text-xl font-bold text-white">
                    {formatNumber(summary.tokens.totalSpent)}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-white/[0.02]">
                  <p className="text-sm text-gray-400">Purchases</p>
                  <p className="text-xl font-bold text-white">
                    {formatNumber(summary.tokens.purchaseCount)}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-white/[0.02]">
                  <p className="text-sm text-gray-400">Avg Purchase</p>
                  <p className="text-xl font-bold text-white">
                    {formatNumber(summary.tokens.avgPurchaseSize)}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
