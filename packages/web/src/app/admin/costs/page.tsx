'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  Cpu,
  RefreshCw,
  AlertCircle,
  BarChart3,
  Layers,
} from 'lucide-react';
import {
  getCostSummary,
  getCostTrend,
  getCostByProvider,
  getCostByModel,
  getTopUsersByCost,
  type CostSummary,
  type CostTrendPoint,
  type ProviderCost,
  type ModelCost,
  type TopUser,
} from '@/lib/api/costs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function CostsDashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [trend, setTrend] = useState<CostTrendPoint[]>([]);
  const [providers, setProviders] = useState<ProviderCost[]>([]);
  const [models, setModels] = useState<ModelCost[]>([]);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [selectedDays, setSelectedDays] = useState(30);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [summaryRes, trendRes, providersRes, modelsRes, usersRes] = await Promise.all([
        getCostSummary(selectedDays),
        getCostTrend(selectedDays),
        getCostByProvider(selectedDays),
        getCostByModel(selectedDays, 10),
        getTopUsersByCost(selectedDays, 10),
      ]);

      setSummary(summaryRes.data);
      setTrend(trendRes.data.trend);
      setProviders(providersRes.data.providers);
      setModels(modelsRes.data.models);
      setTopUsers(usersRes.data.users);
    } catch (error) {
      console.error('Failed to fetch cost data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDays]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatCost = (cost: number) => {
    if (cost === 0) return '$0.00';
    if (cost < 0.01) return '<$0.01';
    if (cost < 1) return `$${cost.toFixed(3)}`;
    if (cost < 100) return `$${cost.toFixed(2)}`;
    return `$${cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  // Calculate trend direction
  const calculateTrendDirection = () => {
    if (trend.length < 2) return null;
    const recentHalf = trend.slice(Math.floor(trend.length / 2));
    const olderHalf = trend.slice(0, Math.floor(trend.length / 2));
    const recentAvg = recentHalf.reduce((sum, p) => sum + p.costUsd, 0) / recentHalf.length;
    const olderAvg = olderHalf.reduce((sum, p) => sum + p.costUsd, 0) / olderHalf.length;
    const change = ((recentAvg - olderAvg) / (olderAvg || 1)) * 100;
    return { direction: change > 0 ? 'up' : 'down', percent: Math.abs(change) };
  };

  const trendInfo = calculateTrendDirection();

  // Simple sparkline visualization
  const renderSparkline = () => {
    if (trend.length === 0) return null;
    const max = Math.max(...trend.map((p) => p.costUsd), 0.01);
    return (
      <div className="flex items-end gap-0.5 h-8">
        {trend.slice(-14).map((point, i) => (
          <div
            key={point.date}
            className="flex-1 bg-campfire-500/60 rounded-t min-w-[4px]"
            style={{ height: `${(point.costUsd / max) * 100}%` }}
            title={`${point.date}: ${formatCost(point.costUsd)}`}
          />
        ))}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">LLM Costs</h1>
        </div>
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">LLM Costs</h1>
          <p className="text-gray-400 text-sm mt-1">
            Track LLM usage, costs, and budget management
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex gap-1 bg-white/[0.02] rounded-lg p-1">
            {[7, 30, 90].map((days) => (
              <Button
                key={days}
                variant={selectedDays === days ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setSelectedDays(days)}
                className={cn(
                  'text-xs',
                  selectedDays === days && 'bg-campfire-500/20 text-campfire-500'
                )}
              >
                {days}d
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchData()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        {/* Total Cost */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Total Cost</p>
                  <p className="text-2xl font-semibold text-white">
                    {summary ? formatCost(summary.totals.costUsd) : '-'}
                  </p>
                </div>
              </div>
              {trendInfo && (
                <div
                  className={cn(
                    'flex items-center gap-1 text-sm',
                    trendInfo.direction === 'up' ? 'text-red-400' : 'text-green-400'
                  )}
                >
                  {trendInfo.direction === 'up' ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {trendInfo.percent.toFixed(0)}%
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Total Requests */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Requests</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? formatNumber(summary.totals.requests) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Active Users */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Active Users</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? formatNumber(summary.totals.uniqueUsers) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Avg Cost per User */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
                <Cpu className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Avg/User</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? formatCost(summary.totals.avgCostPerUser) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Trend */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-campfire-500" />
            Cost Trend ({selectedDays} Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-32 flex items-end gap-1">
            {trend.length === 0 ? (
              <p className="text-gray-500 text-center w-full py-8">No cost data available yet.</p>
            ) : (
              trend.map((point) => {
                const max = Math.max(...trend.map((p) => p.costUsd), 0.01);
                const height = (point.costUsd / max) * 100;
                return (
                  <div
                    key={point.date}
                    className="flex-1 group relative"
                    title={`${point.date}: ${formatCost(point.costUsd)}`}
                  >
                    <div
                      className="w-full bg-campfire-500/60 hover:bg-campfire-500 transition-colors rounded-t cursor-pointer"
                      style={{ height: `${Math.max(height, 2)}%` }}
                    />
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {point.date}: {formatCost(point.costUsd)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>{trend[0]?.date}</span>
            <span>{trend[trend.length - 1]?.date}</span>
          </div>
        </CardContent>
      </Card>

      {/* Provider and Model Breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* By Provider */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Layers className="h-5 w-5 text-blue-500" />
              Cost by Provider
            </CardTitle>
          </CardHeader>
          <CardContent>
            {providers.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No provider data yet.</p>
            ) : (
              <div className="space-y-4">
                {providers.map((provider) => {
                  const maxCost = Math.max(...providers.map((p) => p.costUsd), 0.01);
                  const width = (provider.costUsd / maxCost) * 100;
                  return (
                    <div key={provider.provider}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-white capitalize">{provider.provider}</span>
                        <span className="text-gray-400">{formatCost(provider.costUsd)}</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>{formatNumber(provider.requests)} requests</span>
                        <span>{formatNumber(provider.tokens)} tokens</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* By Model */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Cpu className="h-5 w-5 text-purple-500" />
              Cost by Model
            </CardTitle>
          </CardHeader>
          <CardContent>
            {models.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No model data yet.</p>
            ) : (
              <div className="space-y-3">
                {models.slice(0, 8).map((model) => {
                  const maxCost = Math.max(...models.map((m) => m.costUsd), 0.01);
                  const width = (model.costUsd / maxCost) * 100;
                  // Truncate long model names
                  const displayName =
                    model.model.length > 35 ? model.model.slice(0, 32) + '...' : model.model;
                  return (
                    <div key={model.model}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-white truncate mr-2" title={model.model}>
                          {displayName}
                        </span>
                        <span className="text-gray-400 flex-shrink-0">
                          {formatCost(model.costUsd)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 rounded-full transition-all"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Users */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-green-500" />
            Top Users by Cost
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topUsers.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No user data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-white/5">
                    <th className="pb-3 font-medium">Rank</th>
                    <th className="pb-3 font-medium">User ID</th>
                    <th className="pb-3 font-medium text-right">Requests</th>
                    <th className="pb-3 font-medium text-right">Cost</th>
                    <th className="pb-3 font-medium text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topUsers.map((user, index) => (
                    <tr key={user.userId} className="border-b border-white/5 last:border-0">
                      <td className="py-3 text-gray-400">#{index + 1}</td>
                      <td className="py-3">
                        <span className="text-white font-mono text-sm">
                          {user.userId.slice(0, 8)}...
                        </span>
                      </td>
                      <td className="py-3 text-right text-gray-400">
                        {formatNumber(user.requestCount)}
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-white font-medium">
                          {formatCost(user.totalCostUsd)}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-green-400 font-medium">
                          {formatCost(user.revenueUsd)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Token Usage Summary */}
      {summary && (
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white">Token Usage Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="p-4 rounded-lg bg-white/[0.02]">
                <p className="text-sm text-gray-400">Input Tokens</p>
                <p className="text-2xl font-bold text-white">
                  {formatNumber(summary.totals.inputTokens)}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-white/[0.02]">
                <p className="text-sm text-gray-400">Output Tokens</p>
                <p className="text-2xl font-bold text-white">
                  {formatNumber(summary.totals.outputTokens)}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-white/[0.02]">
                <p className="text-sm text-gray-400">Total Tokens</p>
                <p className="text-2xl font-bold text-white">
                  {formatNumber(summary.totals.inputTokens + summary.totals.outputTokens)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
