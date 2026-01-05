'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Target, BarChart3, Building2, RefreshCw, Video, CheckCircle2, XCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { OverviewTab } from '@/components/admin/ads/overview-tab';
import { CampaignsTab } from '@/components/admin/ads/campaigns-tab';
import { AccountsTab } from '@/components/admin/ads/accounts-tab';
import { CreativeTab } from '@/components/admin/ads/creative-tab';

type TabType = 'overview' | 'campaigns' | 'accounts' | 'creative';

const successMessages: Record<string, string> = {
  facebook_connected: 'Facebook Ads account connected successfully!',
  google_connected: 'Google Ads account connected successfully!',
};

const errorMessages: Record<string, string> = {
  oauth_denied: 'Authorization was denied. Please try again.',
  oauth_failed: 'Connection failed. Please try again.',
  missing_code: 'Invalid callback. Please try again.',
};

const tabs: { id: TabType; label: string; icon: typeof Target }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'campaigns', label: 'Campaigns', icon: Target },
  { id: 'accounts', label: 'Accounts', icon: Building2 },
  { id: 'creative', label: 'Creative', icon: Video },
];

export default function AdsPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [selectedDays, setSelectedDays] = useState(30);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayType, setOverlayType] = useState<'success' | 'error' | null>(null);
  const [overlayMessage, setOverlayMessage] = useState('');

  // Check for success/error params on mount
  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');

    if (success) {
      setOverlayType('success');
      setOverlayMessage(successMessages[success] || 'Account connected successfully!');
      setShowOverlay(true);
    } else if (error) {
      setOverlayType('error');
      setOverlayMessage(errorMessages[error] || 'An error occurred. Please try again.');
      setShowOverlay(true);
    }
  }, [searchParams]);

  // Hide body scrollbars when overlay is shown
  useEffect(() => {
    if (showOverlay) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showOverlay]);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const handleCloseWindow = () => {
    window.close();
    // If window.close() doesn't work (e.g., not opened by script), hide overlay
    setShowOverlay(false);
  };

  return (
    <div className="space-y-6">
      {/* OAuth Result Overlay */}
      {showOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-sm mx-4 bg-gray-900 border border-white/10 rounded-2xl p-8 text-center shadow-2xl">
            <button
              onClick={() => setShowOverlay(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            {overlayType === 'success' ? (
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
            ) : (
              <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            )}

            <h2 className={cn(
              "text-xl font-semibold mb-2",
              overlayType === 'success' ? 'text-green-500' : 'text-red-500'
            )}>
              {overlayType === 'success' ? 'Success!' : 'Error'}
            </h2>

            <p className="text-gray-300 mb-6">
              {overlayMessage}
            </p>

            <Button
              onClick={handleCloseWindow}
              className={cn(
                "w-full",
                overlayType === 'success'
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-campfire-500 hover:bg-campfire-600'
              )}
            >
              Close Window
            </Button>

            <p className="text-gray-500 text-xs mt-4">
              You can safely close this window
            </p>
          </div>
        </div>
      )}
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
        {activeTab === 'creative' && (
          <CreativeTab refreshKey={refreshKey} />
        )}
      </div>
    </div>
  );
}
