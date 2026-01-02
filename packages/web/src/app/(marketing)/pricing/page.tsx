'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { motion } from 'framer-motion';
import { Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const pricing = {
  tiers: [
    {
      name: 'Free',
      id: 'free',
      description: 'Get to know your companion.',
      priceMonthly: 0,
      priceYearly: 0,
      features: [
        '30 voice minutes / month',
        'Text chat unlimited',
        '1 companion',
        'Basic memory',
        'Community support',
      ],
      cta: 'Start Free',
      mostPopular: false,
    },
    {
      name: 'Plus',
      id: 'plus',
      description: 'For deeper connections.',
      priceMonthly: 15,
      priceYearly: 144,
      features: [
        '300 voice minutes / month',
        'Unlimited text chat',
        '3 companions',
        'Long-term memory',
        'Image generation',
        'Custom voice selection',
        'Priority support',
      ],
      cta: 'Get Plus',
      mostPopular: true,
    },
    {
      name: 'Unlimited',
      id: 'unlimited',
      description: 'No limits. Full experience.',
      priceMonthly: 30,
      priceYearly: 288,
      features: [
        'Unlimited voice minutes',
        'Unlimited companions',
        'Advanced memory & recall',
        'HD image generation',
        'Early access features',
        'Custom companion visuals',
        'Priority queue',
      ],
      cta: 'Go Unlimited',
      mostPopular: false,
    },
  ],
};

type BillingCycle = 'monthly' | 'yearly';

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  return (
    <div className="py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h1 className="text-3xl sm:text-4xl font-display font-bold">
            Simple, transparent pricing
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Choose the plan that's right for you. No hidden fees. Cancel anytime.
          </p>
        </div>

        <div className="flex items-center justify-center gap-4 mb-16">
          <Label
            htmlFor="billing-switch"
            className={cn(
              'cursor-pointer text-sm font-medium',
              billingCycle === 'monthly' ? 'text-foreground' : 'text-muted-foreground'
            )}
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
            className={cn(
              'cursor-pointer text-sm font-medium',
              billingCycle === 'yearly' ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            Yearly <span className="ml-1 text-xs text-green-500 font-normal">(Save 20%)</span>
          </Label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {pricing.tiers.map((tier, index) => (
            <motion.div
              key={tier.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card
                className={cn(
                  'h-full relative',
                  tier.mostPopular && 'border-primary shadow-lg'
                )}
              >
                {tier.mostPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}
                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-xl">{tier.name}</CardTitle>
                  <CardDescription>{tier.description}</CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="text-center mb-6">
                    <span className="text-4xl font-bold">
                      ${billingCycle === 'monthly' ? tier.priceMonthly : Math.round(tier.priceYearly / 12)}
                    </span>
                    <span className="text-muted-foreground">/month</span>
                    {billingCycle === 'yearly' && tier.priceYearly > 0 && (
                      <p className="text-sm text-muted-foreground mt-1">
                        Billed ${tier.priceYearly}/year
                      </p>
                    )}
                  </div>

                  <ul className="space-y-3 mb-6">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    className="w-full"
                    variant={tier.mostPopular ? 'default' : 'outline'}
                    asChild
                  >
                    <Link href="/onboard">
                      {tier.cta}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="mt-24 text-center">
          <h3 className="text-xl font-semibold mb-4">Have questions?</h3>
          <p className="text-muted-foreground">
            Check out our{' '}
            <Link href={'/faq' as Route} className="text-primary hover:underline">
              FAQ page
            </Link>{' '}
            or{' '}
            <Link href={'/contact' as Route} className="text-primary hover:underline">
              contact us
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
