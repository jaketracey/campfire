'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  DollarSign,
  Users,
  ShoppingCart,
  TrendingUp,
  Calculator,
  Banknote,
  Target,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  getAdsOverview,
  getSpendTrend,
  type AdsOverview,
  type SpendTrendPoint,
} from '@/lib/api/ads';

interface OverviewTabProps {
  days: number;
  refreshKey: number;
}

export function OverviewTab({ days, refreshKey }: OverviewTabProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [overview, setOverview] = useState<AdsOverview | null>(null);
  const [trend, setTrend] = useState<SpendTrendPoint[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [overviewRes, trendRes] = await Promise.all([
        getAdsOverview(days),
        getSpendTrend(days),
      ]);

      setOverview(overviewRes.data);
      setTrend(trendRes.data.trend);
    } catch (error) {
      console.error('Failed to fetch ads overview data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}x`;
  };

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

  return (
    <div className="space-y-6">
      {/* Primary Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        {/* Total Spend */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10 text-red-500">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Total Spend</p>
                <p className="text-2xl font-semibold text-white">
                  {overview ? formatCurrency(overview.totalSpend) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Signups */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Signups</p>
                <p className="text-2xl font-semibold text-white">
                  {overview ? formatNumber(overview.totalSignups) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Conversions */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
                <ShoppingCart className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Conversions</p>
                <p className="text-2xl font-semibold text-white">
                  {overview ? formatNumber(overview.totalConversions) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Revenue */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
                <Banknote className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Revenue</p>
                <p className="text-2xl font-semibold text-white">
                  {overview ? formatCurrency(overview.totalRevenue) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ROI Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        {/* ROAS */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">ROAS</p>
                <p className={cn(
                  'text-2xl font-semibold',
                  overview && overview.roas >= 1 ? 'text-green-400' : 'text-red-400'
                )}>
                  {overview ? formatPercent(overview.roas) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CPA */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                <Calculator className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">CPA</p>
                <p className="text-2xl font-semibold text-white">
                  {overview ? formatCurrency(overview.cpa) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* LTV */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-500">
                <Target className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">LTV</p>
                <p className="text-2xl font-semibold text-white">
                  {overview ? formatCurrency(overview.ltv) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* LTV/CAC Ratio */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-pink-500/10 text-pink-500">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">LTV/CAC</p>
                <p className={cn(
                  'text-2xl font-semibold',
                  overview && overview.ltvCacRatio >= 3 ? 'text-green-400' :
                  overview && overview.ltvCacRatio >= 1 ? 'text-yellow-400' : 'text-red-400'
                )}>
                  {overview ? formatPercent(overview.ltvCacRatio) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Spend Trend Chart */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-campfire-500" />
            Daily Spend ({days} Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-end gap-1">
            {!trend || trend.length === 0 ? (
              <p className="text-gray-500 text-center w-full py-8">No spend data available yet.</p>
            ) : (
              trend.map((point) => {
                const max = Math.max(...trend.map((p) => p.totalSpend), 1);
                const googleHeight = (point.googleSpend / max) * 100;
                const facebookHeight = (point.facebookSpend / max) * 100;
                return (
                  <div
                    key={point.date}
                    className="flex-1 group relative flex flex-col justify-end h-full"
                    title={`${point.date}: Google ${formatCurrency(point.googleSpend)}, Facebook ${formatCurrency(point.facebookSpend)}`}
                  >
                    <div className="flex flex-col-reverse">
                      <div
                        className="w-full bg-blue-500/60 hover:bg-blue-500 transition-colors"
                        style={{ height: `${Math.max(googleHeight, 0)}%`, minHeight: googleHeight > 0 ? '2px' : '0' }}
                      />
                      <div
                        className="w-full bg-indigo-500/60 hover:bg-indigo-500 transition-colors"
                        style={{ height: `${Math.max(facebookHeight, 0)}%`, minHeight: facebookHeight > 0 ? '2px' : '0' }}
                      />
                    </div>
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      <div>{point.date}</div>
                      <div className="text-blue-400">Google: {formatCurrency(point.googleSpend)}</div>
                      <div className="text-indigo-400">Facebook: {formatCurrency(point.facebookSpend)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {trend && trend.length > 0 && (
            <>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span>{trend[0]?.date}</span>
                <span>{trend[trend.length - 1]?.date}</span>
              </div>
              <div className="flex gap-4 mt-4 justify-center">
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded bg-blue-500" />
                  <span className="text-gray-400">Google Ads</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded bg-indigo-500" />
                  <span className="text-gray-400">Facebook Ads</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Platform Breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Google Ads */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-blue-500 flex items-center justify-center text-xs font-bold">
                G
              </div>
              Google Ads
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!overview ? (
              <p className="text-gray-500 text-center py-8">No data available.</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-400">Spend</p>
                  <p className="text-xl font-semibold text-white">
                    {formatCurrency(overview.platformBreakdown.google.spend)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Signups</p>
                  <p className="text-xl font-semibold text-white">
                    {formatNumber(overview.platformBreakdown.google.signups)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Conversions</p>
                  <p className="text-xl font-semibold text-white">
                    {formatNumber(overview.platformBreakdown.google.conversions)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Revenue</p>
                  <p className="text-xl font-semibold text-white">
                    {formatCurrency(overview.platformBreakdown.google.revenue)}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Facebook Ads */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-indigo-500 flex items-center justify-center text-xs font-bold">
                f
              </div>
              Facebook Ads
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!overview ? (
              <p className="text-gray-500 text-center py-8">No data available.</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-400">Spend</p>
                  <p className="text-xl font-semibold text-white">
                    {formatCurrency(overview.platformBreakdown.facebook.spend)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Signups</p>
                  <p className="text-xl font-semibold text-white">
                    {formatNumber(overview.platformBreakdown.facebook.signups)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Conversions</p>
                  <p className="text-xl font-semibold text-white">
                    {formatNumber(overview.platformBreakdown.facebook.conversions)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Revenue</p>
                  <p className="text-xl font-semibold text-white">
                    {formatCurrency(overview.platformBreakdown.facebook.revenue)}
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
