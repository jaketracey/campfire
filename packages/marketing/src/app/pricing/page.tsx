'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { PricingCard } from '@/components/stripe/pricing-card';
import { pricing } from '@/lib/constants';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { type BillingCycle } from '@/lib/stripe';
import { SectionHeader } from '@/components/layout/section-header';

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = React.useState<BillingCycle>('monthly');

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  return (
    <div className="relative min-h-screen">
      {/* Vibes Background */}
      <div className="fixed inset-0 pointer-events-none z-[-1]">
        <div className="absolute top-[-10%] left-[20%] w-[60%] h-[60%] bg-vibes-hot/5 rounded-full blur-[120px] animate-pulse-slow" />
        <div className="absolute bottom-[-10%] right-[10%] w-[40%] h-[40%] bg-vibes-cyan/10 rounded-full blur-[100px] animate-float" />
      </div>

      <div className="container py-24 md:py-32">
        <SectionHeader
          title="Simple, transparent pricing"
          description="Choose the plan that's right for you. No hidden fees. Cancel anytime."
          className="mb-12"
        />

        <div className="flex items-center justify-center gap-4 mb-16">
          <Label
            htmlFor="billing-switch"
            className={`cursor-pointer text-sm font-medium ${billingCycle === 'monthly' ? 'text-foreground' : 'text-muted-foreground'
              }`}
          >
            Monthly
          </Label>
          <Switch
            id="billing-switch"
            checked={billingCycle === 'yearly'}
            onCheckedChange={(checked) => setBillingCycle(checked ? 'yearly' : 'monthly')}
          />
          <Label
            htmlFor="billing-switch"
            className={`cursor-pointer text-sm font-medium ${billingCycle === 'yearly' ? 'text-foreground' : 'text-muted-foreground'
              }`}
          >
            Yearly <span className="ml-1 text-xs text-success-500 font-normal">(Save 20%)</span>
          </Label>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto"
        >
          {pricing.tiers.map((tier) => (
            <PricingCard
              key={tier.id}
              {...tier}
              // @ts-ignore - id is typed as string in constants but literal in component
              id={tier.id}
              billingCycle={billingCycle}
            />
          ))}
        </motion.div>

        <div className="mt-24 text-center">
          <h3 className="text-xl font-semibold mb-4">Frequently Asked Questions</h3>
          <p className="text-muted-foreground mb-8">
            Have questions? Check out our <a href="/faq" className="text-brand-500 hover:underline">FAQ page</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
