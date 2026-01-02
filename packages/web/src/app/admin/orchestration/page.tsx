'use client';

import { useEffect, useState, useCallback } from 'react';
import { Activity, AlertCircle, CheckCircle2, Clock, PlayCircle, RefreshCw, Zap, DollarSign, Shield, BarChart3 } from 'lucide-react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function OrchestrationDashboardPage() {
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

  const fetchData = useCallback(async () => {
    try {
      const [runsRes, statsRes, metricsRes, providersRes, healthRes] = await Promise.all([
        listTestRuns({ limit: 5 }),
        getTestRunStats(30),
        getMetricsSummary({ days: 30 }),
        getProviderHealth(),
        checkOrchestratorHealth(),
      ]);

      setTestRuns(runsRes.data.runs);
      setTestStats(statsRes.data);
      setMetrics(metricsRes.data);
      setProviders(providersRes.data.providers);
      setOrchestratorHealth(healthRes.data);
    } catch (error) {
      console.error('Failed to fetch orchestration data:', error);
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
      // Refresh data after a short delay
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
    if (cost < 0.01) return '<$0.01';
    return `$${cost.toFixed(2)}`;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Orchestration</h1>
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
          <h1 className="text-2xl font-bold text-white">Orchestration</h1>
          <p className="text-gray-400 text-sm mt-1">
            Test runs, metrics, and provider health monitoring
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

      {/* Status Overview */}
      <div className="grid gap-4 md:grid-cols-4">
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

        {/* Test Pass Rate */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
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

        {/* Total Cost */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">30-Day Cost</p>
                <p className="text-lg font-semibold text-white">
                  {metrics ? formatCost(metrics.totalCostUsd) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Provider Status */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-500" />
            Provider Health
          </CardTitle>
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

      {/* Recent Test Runs and Metrics */}
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

        {/* Metrics Summary */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-purple-500" />
              30-Day Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metrics ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-white/[0.02]">
                    <p className="text-sm text-gray-400">Total Requests</p>
                    <p className="text-2xl font-bold text-white">
                      {metrics.totalRequests.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-white/[0.02]">
                    <p className="text-sm text-gray-400">Avg Latency</p>
                    <p className="text-2xl font-bold text-white">
                      {Math.round(metrics.avgLatencyMs)}ms
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-white/[0.02]">
                    <p className="text-sm text-gray-400">Safety Pass Rate</p>
                    <p className="text-2xl font-bold text-white">
                      {metrics.safetyPassRate.toFixed(1)}%
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-white/[0.02]">
                    <p className="text-sm text-gray-400">Total Cost</p>
                    <p className="text-2xl font-bold text-white">
                      {formatCost(metrics.totalCostUsd)}
                    </p>
                  </div>
                </div>

                {/* Provider breakdown */}
                <div>
                  <p className="text-sm text-gray-400 mb-2">By Provider</p>
                  <div className="space-y-2">
                    {Object.entries(metrics.providerBreakdown).map(
                      ([provider, stats]) => (
                        <div
                          key={provider}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="text-white capitalize">{provider}</span>
                          <span className="text-gray-400">
                            {stats.requests.toLocaleString()} requests
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">
                No metrics data available yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

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
