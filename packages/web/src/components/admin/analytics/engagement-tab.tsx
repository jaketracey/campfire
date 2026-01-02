'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Users,
  Activity,
  MessageSquare,
  Clock,
  TrendingUp,
  TrendingDown,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  getEngagementSummary,
  getCompanionAnalytics,
  getUserDistribution,
  type EngagementSummary,
  type CompanionStats,
  type UserActivityBucket,
} from '@/lib/api/analytics';

interface EngagementTabProps {
  days: number;
  refreshKey: number;
}

export function EngagementTab({ days, refreshKey }: EngagementTabProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<EngagementSummary | null>(null);
  const [companions, setCompanions] = useState<CompanionStats[]>([]);
  const [distribution, setDistribution] = useState<UserActivityBucket[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [summaryRes, companionsRes, distributionRes] = await Promise.all([
        getEngagementSummary(days),
        getCompanionAnalytics(days, 10),
        getUserDistribution(days),
      ]);

      setSummary(summaryRes.data);
      setCompanions(companionsRes.data.companions);
      setDistribution(distributionRes.data.distribution);
    } catch (error) {
      console.error('Failed to fetch engagement data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null || ms === 0) return '-';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  // Calculate DAU trend direction from trends data
  const calculateDauTrend = () => {
    if (!summary?.trends || summary.trends.length < 2) return null;
    const recent = summary.trends.slice(-7);
    const older = summary.trends.slice(-14, -7);
    if (older.length === 0) return null;

    const recentAvg = recent.reduce((sum, t) => sum + t.dailyActiveUsers, 0) / recent.length;
    const olderAvg = older.reduce((sum, t) => sum + t.dailyActiveUsers, 0) / older.length;
    const change = ((recentAvg - olderAvg) / (olderAvg || 1)) * 100;

    return { direction: change > 0 ? 'up' : 'down', percent: Math.abs(change) };
  };

  const dauTrend = calculateDauTrend();

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
      {/* Key Metrics */}
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
                  <p className="text-2xl font-semibold text-white">
                    {summary ? formatNumber(summary.current.dau) : '-'}
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
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">WAU</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? formatNumber(summary.current.wau) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* MAU */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">MAU</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? formatNumber(summary.current.mau) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* DAU/WAU Ratio */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">DAU/WAU</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? formatPercent(summary.current.dauWauRatio) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Session Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-500">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Avg Session</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? formatDuration(summary.sessions.avgDurationMs) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-pink-500/10 text-pink-500">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Turns/Session</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? summary.sessions.avgTurnsPerSession.toFixed(1) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Sessions/User</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? summary.sessions.sessionsPerUser.toFixed(1) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-500/10 text-rose-500">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Total Sessions</p>
                <p className="text-2xl font-semibold text-white">
                  {summary ? formatNumber(summary.sessions.totalSessions) : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* DAU Trend Chart */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-campfire-500" />
            Daily Active Users ({days} Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-32 flex items-end gap-1">
            {!summary?.trends || summary.trends.length === 0 ? (
              <p className="text-gray-500 text-center w-full py-8">No data available yet.</p>
            ) : (
              summary.trends.map((point) => {
                const max = Math.max(...summary.trends.map((p) => p.dailyActiveUsers), 1);
                const height = (point.dailyActiveUsers / max) * 100;
                return (
                  <div
                    key={point.date}
                    className="flex-1 group relative"
                    title={`${point.date}: ${point.dailyActiveUsers} DAU`}
                  >
                    <div
                      className="w-full bg-blue-500/60 hover:bg-blue-500 transition-colors rounded-t cursor-pointer"
                      style={{ height: `${Math.max(height, 2)}%` }}
                    />
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {point.date}: {point.dailyActiveUsers} DAU
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

      {/* Companion Popularity and User Distribution */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Companions */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              Top Companions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {companions.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No companion data yet.</p>
            ) : (
              <div className="space-y-4">
                {companions.map((companion) => {
                  const maxSessions = Math.max(...companions.map((c) => c.sessionCount), 1);
                  const width = (companion.sessionCount / maxSessions) * 100;
                  return (
                    <div key={companion.companionId}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-white truncate mr-2">{companion.companionName}</span>
                        <span className="text-gray-400 flex-shrink-0">
                          {formatNumber(companion.sessionCount)} sessions
                        </span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 rounded-full transition-all"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>{companion.uniqueUsers} users</span>
                        <span>{formatNumber(companion.totalTurns)} turns</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* User Activity Distribution */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-500" />
              User Activity Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {distribution.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No distribution data yet.</p>
            ) : (
              <div className="space-y-4">
                {distribution.map((bucket) => {
                  const maxUsers = Math.max(...distribution.map((b) => b.userCount), 1);
                  const width = (bucket.userCount / maxUsers) * 100;
                  return (
                    <div key={bucket.bucket}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-white">{bucket.bucket} sessions</span>
                        <span className="text-gray-400">
                          {formatNumber(bucket.userCount)} users ({bucket.percentage.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all"
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
    </div>
  );
}
