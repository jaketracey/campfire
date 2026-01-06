'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  PlayCircle,
  RefreshCw,
  Zap,
  DollarSign,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Users,
  Cpu,
  Layers,
  Crown,
} from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  listTestRuns,
  getTestRunStats,
  getMetricsSummary,
  getProviderHealth,
  checkOrchestratorHealth,
  triggerTestRun,
  type TestRun,
  type TestRunType,
  type ProviderHealth,
  type MetricsSummary,
} from '@/lib/api/orchestration';
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
import {
  getEngagementSummary,
  type EngagementSummary,
} from '@/lib/api/analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TimeSeriesAreaChart } from '@/components/admin/charts/time-series-area-chart';

export default function AdminDashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [testStats, setTestStats] = useState<{
    total_runs: number;
    passed_runs: number;
    failed_runs: number;
    avg_duration_ms: number;
    by_type: Record<string, { total: number; passed: number; failed: number }>;
  } | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [orchestratorHealth, setOrchestratorHealth] = useState<{
    healthy: boolean;
    status: string;
  } | null>(null);
  const [isRunningTest, setIsRunningTest] = useState(false);

  // Cost data
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [costTrend, setCostTrend] = useState<CostTrendPoint[]>([]);
  const [providerCosts, setProviderCosts] = useState<ProviderCost[]>([]);
  const [modelCosts, setModelCosts] = useState<ModelCost[]>([]);

  // Engagement data
  const [engagement, setEngagement] = useState<EngagementSummary | null>(null);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [
        runsRes,
        statsRes,
        metricsRes,
        providersRes,
        healthRes,
        costSummaryRes,
        costTrendRes,
        providerCostsRes,
        modelCostsRes,
        engagementRes,
        topUsersRes,
      ] = await Promise.all([
        listTestRuns({ limit: 5 }),
        getTestRunStats(30),
        getMetricsSummary({ days: 30 }),
        getProviderHealth(),
        checkOrchestratorHealth(),
        getCostSummary(30),
        getCostTrend(30),
        getCostByProvider(30),
        getCostByModel(30, 5),
        getEngagementSummary(30),
        getTopUsersByCost(7, 5), // Top 5 users this week
      ]);

      setTestRuns(runsRes.data.runs);
      setTestStats(statsRes.data);
      setMetrics(metricsRes.data);
      setProviders(providersRes.data.providers);
      setOrchestratorHealth(healthRes.data);
      setCostSummary(costSummaryRes.data);
      setCostTrend(costTrendRes.data.trend);
      setProviderCosts(providerCostsRes.data.providers);
      setModelCosts(modelCostsRes.data.models);
      setEngagement(engagementRes.data);
      setTopUsers(topUsersRes.data.users);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRunTests = async (runType: TestRunType) => {
    setIsRunningTest(true);
    try {
      await triggerTestRun(runType);
      setTimeout(() => {
        fetchData();
        setIsRunningTest(false);
      }, 1000);
    } catch (error) {
      console.error('Failed to trigger test run:', error);
      setIsRunningTest(false);
    }
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

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

  // Calculate trend direction for costs
  const calculateTrendDirection = () => {
    if (costTrend.length < 2) return null;
    const recentHalf = costTrend.slice(Math.floor(costTrend.length / 2));
    const olderHalf = costTrend.slice(0, Math.floor(costTrend.length / 2));
    const recentAvg = recentHalf.reduce((sum, p) => sum + p.costUsd, 0) / recentHalf.length;
    const olderAvg = olderHalf.reduce((sum, p) => sum + p.costUsd, 0) / olderHalf.length;
    const change = ((recentAvg - olderAvg) / (olderAvg || 1)) * 100;
    return { direction: change > 0 ? 'up' : 'down', percent: Math.abs(change) };
  };

  const trendInfo = calculateTrendDirection();

  // Calculate DAU trend from engagement trends
  const calculateDauTrend = () => {
    if (!engagement?.trends || engagement.trends.length < 2) return null;
    const recent = engagement.trends.slice(-7);
    const older = engagement.trends.slice(-14, -7);
    if (older.length === 0) return null;

    const recentAvg = recent.reduce((sum, t) => sum + t.dailyActiveUsers, 0) / recent.length;
    const olderAvg = older.reduce((sum, t) => sum + t.dailyActiveUsers, 0) / older.length;
    const change = ((recentAvg - olderAvg) / (olderAvg || 1)) * 100;

    return { direction: change > 0 ? 'up' : 'down', percent: Math.abs(change) };
  };

  // Calculate WAU trend from engagement trends
  const calculateWauTrend = () => {
    if (!engagement?.trends || engagement.trends.length < 2) return null;
    const recent = engagement.trends.slice(-7);
    const older = engagement.trends.slice(-14, -7);
    if (older.length === 0) return null;

    const recentAvg = recent.reduce((sum, t) => sum + t.weeklyActiveUsers, 0) / recent.length;
    const olderAvg = older.reduce((sum, t) => sum + t.weeklyActiveUsers, 0) / older.length;
    const change = ((recentAvg - olderAvg) / (olderAvg || 1)) * 100;

    return { direction: change > 0 ? 'up' : 'down', percent: Math.abs(change) };
  };

  const dauTrend = calculateDauTrend();
  const wauTrend = calculateWauTrend();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
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

  const configuredProviders = providers.filter((p) => p.isConfigured).length;
  const availableProviders = providers.filter((p) => p.isAvailable).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">
            System health, metrics, and cost overview
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => handleRunTests('all')}
            disabled={isRunningTest}
            className="gap-2 bg-campfire-600 hover:bg-campfire-700"
          >
            <PlayCircle className="h-4 w-4" />
            {isRunningTest ? 'Running...' : 'Run All Tests'}
          </Button>
        </div>
      </div>

      {/* Key Metrics Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Orchestrator Health */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'p-2 rounded-lg',
                  orchestratorHealth?.healthy
                    ? 'bg-green-500/10 text-green-500'
                    : 'bg-red-500/10 text-red-500'
                )}
              >
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Orchestrator</p>
                <p className="text-lg font-semibold text-white">
                  {orchestratorHealth?.healthy ? 'Healthy' : 'Unhealthy'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Provider Health */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Providers</p>
                <p className="text-lg font-semibold text-white">
                  {availableProviders}/{configuredProviders} Online
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Cost */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">30-Day Cost</p>
                  <p className="text-lg font-semibold text-white">
                    {costSummary ? formatCost(costSummary.totals.costUsd) : '-'}
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
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Total Requests</p>
                <p className="text-lg font-semibold text-white">
                  {metrics ? formatNumber(metrics.totalRequests) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Engagement Metrics - DAU/WAU */}
      <div className="grid gap-4 md:grid-cols-4">
        {/* DAU */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">DAU</p>
                  <p className="text-lg font-semibold text-white">
                    {engagement ? formatNumber(engagement.current.dau) : '-'}
                  </p>
                </div>
              </div>
              {dauTrend && (
                <div
                  className={cn(
                    'flex items-center gap-1 text-sm',
                    dauTrend.direction === 'up' ? 'text-green-400' : 'text-red-400'
                  )}
                >
                  {dauTrend.direction === 'up' ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {dauTrend.percent.toFixed(0)}%
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* WAU */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">WAU</p>
                  <p className="text-lg font-semibold text-white">
                    {engagement ? formatNumber(engagement.current.wau) : '-'}
                  </p>
                </div>
              </div>
              {wauTrend && (
                <div
                  className={cn(
                    'flex items-center gap-1 text-sm',
                    wauTrend.direction === 'up' ? 'text-green-400' : 'text-red-400'
                  )}
                >
                  {wauTrend.direction === 'up' ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {wauTrend.percent.toFixed(0)}%
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Test Pass Rate */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Test Pass Rate</p>
                <p className="text-lg font-semibold text-white">
                  {testStats && testStats.total_runs > 0
                    ? `${Math.round((testStats.passed_runs / testStats.total_runs) * 100)}%`
                    : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Avg Latency */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-500">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Avg Latency</p>
                <p className="text-lg font-semibold text-white">
                  {metrics ? `${Math.round(metrics.avgLatencyMs)}ms` : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Provider Status */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-500" />
            Provider Health
          </CardTitle>
          <Link href={'/admin/providers' as Route}>
            <Button variant="ghost" size="sm" className="text-campfire-500">
              Manage Providers
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            {providers.map((provider) => {
              const roleColors = {
                primary: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                fallback: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                available: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
                not_configured: 'bg-gray-800/50 text-gray-600 border-gray-700/30',
              };

              return (
                <div
                  key={provider.provider}
                  className={cn(
                    'p-4 rounded-lg border',
                    provider.isConfigured
                      ? provider.isAvailable
                        ? 'bg-green-500/5 border-green-500/20'
                        : 'bg-red-500/5 border-red-500/20'
                      : 'bg-gray-900/50 border-gray-800/50'
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn(
                      'font-medium capitalize',
                      provider.isConfigured ? 'text-white' : 'text-gray-500'
                    )}>
                      {provider.provider}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn('text-xs', roleColors[provider.role])}
                    >
                      {provider.role === 'not_configured' ? 'N/A' : provider.role}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {provider.isConfigured ? (
                      <>
                        <div className="flex items-center gap-1">
                          <span className={cn(
                            'w-2 h-2 rounded-full',
                            provider.isAvailable ? 'bg-green-500' : 'bg-red-500'
                          )} />
                          <span className="text-xs text-gray-400">
                            {provider.isAvailable ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        {provider.model && (
                          <div className="text-xs text-gray-500 truncate" title={provider.model}>
                            {provider.model.split('/').pop()?.split(':')[0] || provider.model}
                          </div>
                        )}
                        {provider.avgLatencyMs ? (
                          <div className="text-xs text-gray-500">
                            {Math.round(provider.avgLatencyMs)}ms avg
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="text-xs text-gray-600">Not configured</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Cost Trend & Provider Costs */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cost Trend */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-campfire-500" />
              Cost Trend (30 Days)
            </CardTitle>
            <Link href={'/admin/costs' as Route}>
              <Button variant="ghost" size="sm" className="text-campfire-500">
                View Details
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="h-24">
              {costTrend.length === 0 ? (
                <p className="text-gray-500 text-center w-full py-8">No cost data yet.</p>
              ) : (
                <TimeSeriesAreaChart
                  data={costTrend.map((p) => ({ label: p.date, value: p.costUsd }))}
                  formatValue={formatCost}
                  className="rounded-md"
                />
              )}
            </div>
            <div className="flex justify-between mt-2 text-xs text-gray-500">
              <span>{costTrend[0]?.date}</span>
              <span>{costTrend[costTrend.length - 1]?.date}</span>
            </div>
          </CardContent>
        </Card>

        {/* Cost by Provider */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Layers className="h-5 w-5 text-blue-500" />
              Cost by Provider
            </CardTitle>
          </CardHeader>
          <CardContent>
            {providerCosts.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No provider data yet.</p>
            ) : (
              <div className="space-y-4">
                {providerCosts.slice(0, 5).map((provider) => {
                  const maxCost = Math.max(...providerCosts.map((p) => p.costUsd), 0.01);
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
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Test Runs and Top Models */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Test Runs */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Recent Test Runs
            </CardTitle>
            <Link href={'/admin/orchestration/tests' as Route}>
              <Button variant="ghost" size="sm" className="text-campfire-500">
                View All
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {testRuns.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No test runs yet. Run tests to see results.
              </p>
            ) : (
              <div className="space-y-3">
                {testRuns.map((run) => (
                  <Link
                    key={run.id}
                    href={`/admin/orchestration/tests/${run.id}` as Route}
                    className="block"
                  >
                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                      <div className="flex items-center gap-3">
                        {run.status === 'completed' && run.failed === 0 ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        ) : run.status === 'completed' ? (
                          <AlertCircle className="h-5 w-5 text-amber-500" />
                        ) : run.status === 'running' ? (
                          <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />
                        ) : (
                          <Clock className="h-5 w-5 text-gray-500" />
                        )}
                        <div>
                          <p className="text-sm font-medium text-white capitalize">
                            {run.runType} Tests
                          </p>
                          <p className="text-xs text-gray-500">
                            {new Date(run.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-white">
                          {run.passed}/{run.totalTests} passed
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDuration(run.durationMs)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Models by Cost */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Cpu className="h-5 w-5 text-purple-500" />
              Top Models by Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            {modelCosts.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No model data yet.</p>
            ) : (
              <div className="space-y-3">
                {modelCosts.map((model) => {
                  const maxCost = Math.max(...modelCosts.map((m) => m.costUsd), 0.01);
                  const width = (model.costUsd / maxCost) * 100;
                  const displayName =
                    model.model.length > 30 ? model.model.slice(0, 27) + '...' : model.model;
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

      {/* Top Users This Week */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            Top Users This Week
          </CardTitle>
          <Link href={'/admin/users' as Route}>
            <Button variant="ghost" size="sm" className="text-campfire-500">
              View All Users
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {topUsers.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No user data this week.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-white/5">
                    <th className="pb-3 font-medium">Rank</th>
                    <th className="pb-3 font-medium">User ID</th>
                    <th className="pb-3 font-medium text-right">Requests</th>
                    <th className="pb-3 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {topUsers.map((user, index) => (
                    <tr key={user.userId} className="border-b border-white/5 last:border-0">
                      <td className="py-3">
                        <span className={cn(
                          'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold',
                          index === 0 ? 'bg-amber-500/20 text-amber-400' :
                          index === 1 ? 'bg-gray-400/20 text-gray-300' :
                          index === 2 ? 'bg-amber-700/20 text-amber-600' :
                          'bg-white/5 text-gray-400'
                        )}>
                          {index + 1}
                        </span>
                      </td>
                      <td className="py-3">
                        <Link
                          href={`/admin/users?search=${user.userId}` as Route}
                          className="text-white font-mono text-sm hover:text-campfire-500 transition-colors"
                        >
                          {user.userId.slice(0, 8)}...
                        </Link>
                      </td>
                      <td className="py-3 text-right text-gray-400">
                        {formatNumber(user.requestCount)}
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-white font-medium">
                          {formatCost(user.totalCostUsd)}
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

      {/* Quick Actions */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => handleRunTests('routing')}
              disabled={isRunningTest}
            >
              <PlayCircle className="h-4 w-4" />
              Run Routing Tests
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => handleRunTests('memory')}
              disabled={isRunningTest}
            >
              <PlayCircle className="h-4 w-4" />
              Run Memory Tests
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => handleRunTests('integration')}
              disabled={isRunningTest}
            >
              <PlayCircle className="h-4 w-4" />
              Run Integration Tests
            </Button>
            <Link href={'/admin/orchestration/tests' as Route}>
              <Button variant="outline" className="w-full justify-start gap-2">
                <BarChart3 className="h-4 w-4" />
                View All Test Runs
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
