'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, UserPlus, MessageSquare, Zap, CreditCard, ArrowDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getConversionFunnel, type ConversionFunnel } from '@/lib/api/analytics';

interface FunnelTabProps {
  refreshKey: number;
}

interface FunnelStep {
  name: string;
  value: number;
  icon: typeof Users;
  color: string;
  conversionRate?: number;
}

export function FunnelTab({ refreshKey }: FunnelTabProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [funnel, setFunnel] = useState<ConversionFunnel | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await getConversionFunnel();
      setFunnel(res.data);
    } catch (error) {
      console.error('Failed to fetch funnel data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="animate-pulse h-96 bg-white/5 rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!funnel) {
    return (
      <Card className="bg-white/[0.02] border-white/5">
        <CardContent className="p-12 text-center">
          <p className="text-gray-500">No funnel data available yet.</p>
        </CardContent>
      </Card>
    );
  }

  const steps: FunnelStep[] = [
    {
      name: 'Anonymous Visitors',
      value: funnel.anonymousVisitors,
      icon: Users,
      color: 'bg-gray-500',
    },
    {
      name: 'Signed Up',
      value: funnel.signedUp,
      icon: UserPlus,
      color: 'bg-blue-500',
      conversionRate: funnel.signupRate,
    },
    {
      name: 'First Session',
      value: funnel.firstSession,
      icon: MessageSquare,
      color: 'bg-purple-500',
    },
    {
      name: 'Activated',
      value: funnel.activated,
      icon: Zap,
      color: 'bg-amber-500',
      conversionRate: funnel.activationRate,
    },
    {
      name: 'Converted (Paid)',
      value: funnel.converted,
      icon: CreditCard,
      color: 'bg-green-500',
      conversionRate: funnel.conversionRate,
    },
  ];

  const maxValue = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div className="space-y-6">
      {/* Key Conversion Rates */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Signup Rate</p>
                <p className="text-2xl font-semibold text-white">
                  {formatPercent(funnel.signupRate)}
                </p>
                <p className="text-xs text-gray-500">Anonymous → Signed Up</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Activation Rate</p>
                <p className="text-2xl font-semibold text-white">
                  {formatPercent(funnel.activationRate)}
                </p>
                <p className="text-xs text-gray-500">Signed Up → Activated</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Conversion Rate</p>
                <p className="text-2xl font-semibold text-white">
                  {formatPercent(funnel.conversionRate)}
                </p>
                <p className="text-xs text-gray-500">Activated → Paid</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Funnel Visualization */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-campfire-500" />
            Conversion Funnel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-3xl mx-auto">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const widthPercent = (step.value / maxValue) * 100;
              const prevValue = index > 0 ? steps[index - 1].value : null;
              const dropoff = prevValue !== null && prevValue > 0
                ? ((prevValue - step.value) / prevValue) * 100
                : null;

              return (
                <div key={step.name}>
                  {/* Dropoff indicator between steps */}
                  {index > 0 && (
                    <div className="flex items-center justify-center py-2">
                      <ArrowDown className="h-4 w-4 text-gray-600" />
                      {dropoff !== null && dropoff > 0 && (
                        <span className="text-xs text-red-400 ml-2">
                          -{dropoff.toFixed(1)}% dropoff
                        </span>
                      )}
                    </div>
                  )}

                  {/* Funnel step */}
                  <div className="relative">
                    <div
                      className={cn(
                        'h-16 rounded-lg flex items-center px-4 transition-all mx-auto',
                        step.color + '/20'
                      )}
                      style={{
                        width: `${Math.max(widthPercent, 20)}%`,
                      }}
                    >
                      <div
                        className={cn(
                          'absolute inset-y-0 left-0 rounded-lg transition-all',
                          step.color
                        )}
                        style={{
                          width: `${widthPercent}%`,
                          opacity: 0.3,
                        }}
                      />
                      <div className="relative flex items-center gap-3 w-full">
                        <div className={cn('p-2 rounded-lg', step.color + '/30')}>
                          <Icon className={cn('h-5 w-5', step.color.replace('bg-', 'text-'))} />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white">{step.name}</p>
                          <p className="text-xs text-gray-400">{formatNumber(step.value)} users</p>
                        </div>
                        {step.conversionRate !== undefined && (
                          <div className="text-right">
                            <p className="text-sm font-semibold text-white">
                              {formatPercent(step.conversionRate)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardContent className="p-6">
          <div className="grid gap-4 md:grid-cols-5">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.name} className="text-center p-4 rounded-lg bg-white/[0.02]">
                  <div className={cn('inline-flex p-2 rounded-lg mb-2', step.color + '/20')}>
                    <Icon className={cn('h-5 w-5', step.color.replace('bg-', 'text-'))} />
                  </div>
                  <p className="text-xl font-bold text-white">{formatNumber(step.value)}</p>
                  <p className="text-xs text-gray-500">{step.name}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
