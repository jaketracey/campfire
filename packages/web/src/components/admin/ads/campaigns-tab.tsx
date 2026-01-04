'use client';

import { useEffect, useState, useCallback } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  getCampaignMetrics,
  type CampaignMetric,
  type AdPlatform,
} from '@/lib/api/ads';

interface CampaignsTabProps {
  days: number;
  refreshKey: number;
}

type SortField = 'campaignName' | 'spend' | 'signups' | 'conversions' | 'revenue' | 'cpa' | 'roas';
type SortOrder = 'asc' | 'desc';

export function CampaignsTab({ days, refreshKey }: CampaignsTabProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<CampaignMetric[]>([]);
  const [platformFilter, setPlatformFilter] = useState<AdPlatform | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('spend');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await getCampaignMetrics({
        platform: platformFilter === 'all' ? undefined : platformFilter,
        days,
      });

      setCampaigns(res.data.campaigns);
    } catch (error) {
      console.error('Failed to fetch campaign data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [days, platformFilter]);

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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const sortedCampaigns = [...campaigns].sort((a, b) => {
    let aValue: number | string;
    let bValue: number | string;

    switch (sortField) {
      case 'campaignName':
        aValue = a.campaignName.toLowerCase();
        bValue = b.campaignName.toLowerCase();
        break;
      case 'spend':
        aValue = a.spend;
        bValue = b.spend;
        break;
      case 'signups':
        aValue = a.signups;
        bValue = b.signups;
        break;
      case 'conversions':
        aValue = a.conversions;
        bValue = b.conversions;
        break;
      case 'revenue':
        aValue = a.revenue;
        bValue = b.revenue;
        break;
      case 'cpa':
        aValue = a.cpa;
        bValue = b.cpa;
        break;
      case 'roas':
        aValue = a.roas;
        bValue = b.roas;
        break;
      default:
        return 0;
    }

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortOrder === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    return sortOrder === 'asc'
      ? (aValue as number) - (bValue as number)
      : (bValue as number) - (aValue as number);
  });

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 text-gray-500" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="h-4 w-4 text-campfire-500" />
    ) : (
      <ArrowDown className="h-4 w-4 text-campfire-500" />
    );
  };

  if (isLoading) {
    return (
      <Card className="bg-white/[0.02] border-white/5">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-white/5 rounded" />
            <div className="h-64 bg-white/5 rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/[0.02] border-white/5">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg text-white">Campaign Performance</CardTitle>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="h-4 w-4" />
              {platformFilter === 'all' ? 'All Platforms' : platformFilter === 'google' ? 'Google' : 'Facebook'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setPlatformFilter('all')}>
              All Platforms
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPlatformFilter('google')}>
              Google Ads
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPlatformFilter('facebook')}>
              Facebook Ads
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        {sortedCampaigns.length === 0 ? (
          <p className="text-gray-500 text-center py-16">No campaign data available yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left py-3 px-2">
                    <button
                      onClick={() => handleSort('campaignName')}
                      className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors"
                    >
                      Campaign
                      <SortIcon field="campaignName" />
                    </button>
                  </th>
                  <th className="text-left py-3 px-2">
                    <span className="text-xs font-medium text-gray-400">Platform</span>
                  </th>
                  <th className="text-right py-3 px-2">
                    <button
                      onClick={() => handleSort('spend')}
                      className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                    >
                      Spend
                      <SortIcon field="spend" />
                    </button>
                  </th>
                  <th className="text-right py-3 px-2">
                    <button
                      onClick={() => handleSort('signups')}
                      className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                    >
                      Signups
                      <SortIcon field="signups" />
                    </button>
                  </th>
                  <th className="text-right py-3 px-2">
                    <button
                      onClick={() => handleSort('conversions')}
                      className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                    >
                      Conversions
                      <SortIcon field="conversions" />
                    </button>
                  </th>
                  <th className="text-right py-3 px-2">
                    <button
                      onClick={() => handleSort('revenue')}
                      className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                    >
                      Revenue
                      <SortIcon field="revenue" />
                    </button>
                  </th>
                  <th className="text-right py-3 px-2">
                    <button
                      onClick={() => handleSort('cpa')}
                      className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                    >
                      CPA
                      <SortIcon field="cpa" />
                    </button>
                  </th>
                  <th className="text-right py-3 px-2">
                    <button
                      onClick={() => handleSort('roas')}
                      className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                    >
                      ROAS
                      <SortIcon field="roas" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedCampaigns.map((campaign) => (
                  <tr
                    key={campaign.id}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3 px-2">
                      <span className="text-sm text-white truncate max-w-[200px] block">
                        {campaign.campaignName}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={cn(
                          'text-xs px-2 py-1 rounded',
                          campaign.platform === 'google'
                            ? 'bg-blue-500/10 text-blue-400'
                            : 'bg-indigo-500/10 text-indigo-400'
                        )}
                      >
                        {campaign.platform === 'google' ? 'Google' : 'Facebook'}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span className="text-sm text-white">
                        {formatCurrency(campaign.spend)}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span className="text-sm text-white">
                        {formatNumber(campaign.signups)}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span className="text-sm text-white">
                        {formatNumber(campaign.conversions)}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span className="text-sm text-white">
                        {formatCurrency(campaign.revenue)}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span className="text-sm text-white">
                        {formatCurrency(campaign.cpa)}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span
                        className={cn(
                          'text-sm font-medium',
                          campaign.roas >= 1 ? 'text-green-400' : 'text-red-400'
                        )}
                      >
                        {campaign.roas.toFixed(2)}x
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
  );
}
