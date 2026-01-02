'use client';

import { useState } from 'react';
import { BarChart3, TrendingUp, DollarSign, Users, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EngagementTab } from '@/components/admin/analytics/engagement-tab';
import { RevenueTab } from '@/components/admin/analytics/revenue-tab';
import { RetentionTab } from '@/components/admin/analytics/retention-tab';
import { FunnelTab } from '@/components/admin/analytics/funnel-tab';

type TabType = 'engagement' | 'revenue' | 'retention' | 'funnel';

const tabs: { id: TabType; label: string; icon: typeof BarChart3 }[] = [
  { id: 'engagement', label: 'Engagement', icon: TrendingUp },
  { id: 'revenue', label: 'Revenue', icon: DollarSign },
  { id: 'retention', label: 'Retention', icon: Users },
  { id: 'funnel', label: 'Funnel', icon: BarChart3 },
];

export default function AnalyticsDashboardPage() {
  const [activeTab, setActiveTab] = useState<TabType>('engagement');
  const [selectedDays, setSelectedDays] = useState(30);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-gray-400 text-sm mt-1">
            Engagement, revenue, and retention metrics
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
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/5 pb-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                isActive
                  ? 'bg-campfire-500/10 text-campfire-500 border border-campfire-500/20'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-[600px]">
        {activeTab === 'engagement' && (
          <EngagementTab days={selectedDays} refreshKey={refreshKey} />
        )}
        {activeTab === 'revenue' && (
          <RevenueTab days={selectedDays} refreshKey={refreshKey} />
        )}
        {activeTab === 'retention' && (
          <RetentionTab refreshKey={refreshKey} />
        )}
        {activeTab === 'funnel' && (
          <FunnelTab refreshKey={refreshKey} />
        )}
      </div>
    </div>
  );
}
