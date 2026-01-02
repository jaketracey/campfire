'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getRetentionCohorts, type RetentionCohort } from '@/lib/api/analytics';

interface RetentionTabProps {
  refreshKey: number;
}

export function RetentionTab({ refreshKey }: RetentionTabProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [cohorts, setCohorts] = useState<RetentionCohort[]>([]);
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await getRetentionCohorts(period, 12);
      setCohorts(res.data.cohorts);
    } catch (error) {
      console.error('Failed to fetch retention data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getRetentionColor = (value: number) => {
    // Gradient from red (0%) through yellow (50%) to green (100%)
    if (value >= 80) return 'bg-green-500/80 text-white';
    if (value >= 60) return 'bg-green-500/50 text-white';
    if (value >= 40) return 'bg-amber-500/50 text-white';
    if (value >= 20) return 'bg-orange-500/50 text-white';
    if (value > 0) return 'bg-red-500/30 text-white';
    return 'bg-white/5 text-gray-500';
  };

  // Determine columns based on period
  const columns = period === 'weekly'
    ? ['D1', 'D7', 'D14', 'D21', 'D28']
    : ['D1', 'D7', 'D14', 'D30', 'D60', 'D90'];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="animate-pulse h-64 bg-white/5 rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period Toggle */}
      <div className="flex justify-end">
        <div className="flex gap-1 bg-white/[0.02] rounded-lg p-1">
          <Button
            variant={period === 'weekly' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setPeriod('weekly')}
            className={cn(
              'text-xs',
              period === 'weekly' && 'bg-campfire-500/20 text-campfire-500'
            )}
          >
            Weekly Cohorts
          </Button>
          <Button
            variant={period === 'monthly' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setPeriod('monthly')}
            className={cn(
              'text-xs',
              period === 'monthly' && 'bg-campfire-500/20 text-campfire-500'
            )}
          >
            Monthly Cohorts
          </Button>
        </div>
      </div>

      {/* Retention Heatmap */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-500" />
            Retention Cohorts
            <span className="text-sm font-normal text-gray-400 ml-2">
              ({period === 'weekly' ? 'Weekly' : 'Monthly'} cohorts, % of users returning)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cohorts.length === 0 ? (
            <p className="text-gray-500 text-center py-12">
              No retention data available yet. Run aggregation to populate cohort data.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-xs text-gray-500 font-medium pb-3 pr-4 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Cohort
                      </div>
                    </th>
                    <th className="text-center text-xs text-gray-500 font-medium pb-3 px-2 whitespace-nowrap">
                      Size
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col}
                        className="text-center text-xs text-gray-500 font-medium pb-3 px-2 whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((cohort) => (
                    <tr key={cohort.cohortDate} className="border-t border-white/5">
                      <td className="py-2 pr-4 text-sm text-white whitespace-nowrap">
                        {formatDate(cohort.cohortDate)}
                      </td>
                      <td className="py-2 px-2 text-center text-sm text-gray-400">
                        {cohort.cohortSize}
                      </td>
                      {columns.map((col) => {
                        const key = col.toLowerCase();
                        const value = cohort.retentionData?.[key] ?? null;
                        return (
                          <td key={col} className="py-2 px-1">
                            <div
                              className={cn(
                                'w-12 h-8 flex items-center justify-center rounded text-xs font-medium mx-auto',
                                value !== null ? getRetentionColor(value) : 'bg-white/5 text-gray-600'
                              )}
                            >
                              {value !== null ? `${value.toFixed(0)}%` : '-'}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-center gap-6 text-xs">
            <span className="text-gray-400">Retention Rate:</span>
            <div className="flex items-center gap-1">
              <span className="w-6 h-4 rounded bg-red-500/30" />
              <span className="text-gray-500">0-20%</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-6 h-4 rounded bg-orange-500/50" />
              <span className="text-gray-500">20-40%</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-6 h-4 rounded bg-amber-500/50" />
              <span className="text-gray-500">40-60%</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-6 h-4 rounded bg-green-500/50" />
              <span className="text-gray-500">60-80%</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-6 h-4 rounded bg-green-500/80" />
              <span className="text-gray-500">80-100%</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
