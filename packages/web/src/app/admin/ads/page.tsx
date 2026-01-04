'use client';

import { useState } from 'react';
import { Target, BarChart3, Building2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { OverviewTab } from '@/components/admin/ads/overview-tab';
import { CampaignsTab } from '@/components/admin/ads/campaigns-tab';
import { AccountsTab } from '@/components/admin/ads/accounts-tab';

type TabType = 'overview' | 'campaigns' | 'accounts';

const tabs: { id: TabType; label: string; icon: typeof Target }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'campaigns', label: 'Campaigns', icon: Target },
  { id: 'accounts', label: 'Accounts', icon: Building2 },
];

export default function AdsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
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
          <h1 className="text-2xl font-bold text-white">Ads</h1>
          <p className="text-gray-400 text-sm mt-1">
            Ad spend tracking, attribution, and ROI analytics
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
        {activeTab === 'overview' && (
          <OverviewTab days={selectedDays} refreshKey={refreshKey} />
        )}
        {activeTab === 'campaigns' && (
          <CampaignsTab days={selectedDays} refreshKey={refreshKey} />
        )}
        {activeTab === 'accounts' && (
          <AccountsTab refreshKey={refreshKey} />
        )}
      </div>
    </div>
  );
}
