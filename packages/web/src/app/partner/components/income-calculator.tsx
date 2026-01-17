'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, Calculator } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { trackEvent, trackCustomEvent } from '@/lib/analytics/meta-pixel';

interface IncomeCalculatorProps {
  affiliateCode?: string | null;
}

export function IncomeCalculator({ affiliateCode }: IncomeCalculatorProps) {
  const [users, setUsers] = useState(100);
  const [avgSpend, setAvgSpend] = useState(25);
  const [hasInteracted, setHasInteracted] = useState(false);

  const revenueShare = 0.5; // 50% average
  const monthlyRevenue = users * avgSpend * revenueShare;
  const annualRevenue = monthlyRevenue * 12;

  const applyUrl = affiliateCode
    ? (`/tenants/apply?aff=${affiliateCode}` as Route)
    : ('/tenants/apply' as Route);

  useEffect(() => {
    if (hasInteracted) {
      trackCustomEvent('PartnerCalculatorInteract', {
        users,
        spend: avgSpend,
        revenue: Math.round(monthlyRevenue),
      });
    }
  }, [hasInteracted, users, avgSpend, monthlyRevenue]);

  const handleInteraction = () => {
    if (!hasInteracted) {
      setHasInteracted(true);
    }
  };

  const handleCTAClick = () => {
    trackEvent('Lead', { content_name: 'partner_calculator_cta' });
    trackCustomEvent('PartnerCTAClick', { location: 'calculator' });
  };

  return (
    <section id="calculator" className="py-16 px-4 bg-white/[0.01]">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 text-campfire-500 mb-4">
            <Calculator className="h-5 w-5" />
            <span className="text-sm font-medium">Income Calculator</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold font-display text-white mb-4">
            See What You Could Earn
          </h2>
          <p className="text-lg text-gray-400">
            Drag the sliders to estimate your monthly revenue.
          </p>
        </div>

        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-white text-center">
              Your Projected Earnings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* Users slider */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-gray-300">
                  Monthly Active Users
                </label>
                <span className="text-lg font-bold text-white">{users.toLocaleString()}</span>
              </div>
              <Slider
                value={[users]}
                onValueChange={([v]) => {
                  setUsers(v);
                  handleInteraction();
                }}
                min={10}
                max={1000}
                step={10}
                className="py-2"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>10</span>
                <span>1,000</span>
              </div>
            </div>

            {/* Avg spend slider */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-gray-300">
                  Average Monthly Spend
                </label>
                <span className="text-lg font-bold text-white">${avgSpend}</span>
              </div>
              <Slider
                value={[avgSpend]}
                onValueChange={([v]) => {
                  setAvgSpend(v);
                  handleInteraction();
                }}
                min={5}
                max={100}
                step={5}
                className="py-2"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>$5</span>
                <span>$100</span>
              </div>
            </div>

            {/* Revenue display */}
            <div className="pt-6 border-t border-white/5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="text-center p-4 rounded-lg bg-white/[0.02]">
                  <div className="text-sm text-gray-400 mb-1">Monthly Revenue</div>
                  <div className="text-3xl font-bold text-campfire-500">
                    ${monthlyRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </div>
                <div className="text-center p-4 rounded-lg bg-campfire-500/10 border border-campfire-500/20">
                  <div className="text-sm text-gray-400 mb-1">Annual Revenue</div>
                  <div className="text-3xl font-bold text-white">
                    ${annualRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500 text-center mt-4">
                Based on 50% revenue share. Top performers earn up to 60%.
              </p>
            </div>

            {/* CTA */}
            <div className="text-center pt-4">
              <Link href={applyUrl} onClick={handleCTAClick}>
                <Button size="lg" className="bg-campfire-500 hover:bg-campfire-600">
                  Start Earning Today
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
