'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckoutButton } from './checkout-button';
import { formatPrice, type PricingPlan, type BillingCycle } from '@/lib/stripe';
import { siteConfig } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';

interface PricingCardProps {
  name: string;
  id: PricingPlan;
  description: string;
  priceMonthly: number | null;
  priceYearly: number | null;
  features: string[];
  cta: string;
  mostPopular: boolean;
  billingCycle: BillingCycle;
}

export function PricingCard({
  name,
  id,
  description,
  priceMonthly,
  priceYearly,
  features,
  cta,
  mostPopular,
  billingCycle,
}: PricingCardProps) {
  const price = billingCycle === 'yearly' ? priceYearly : priceMonthly;
  const isEnterprise = id === 'enterprise';
  const isFree = price === 0;

  const handlePlanClick = () => {
    trackEvent.pricingPlanSelect(id, billingCycle);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
    >
      <Card
        className={cn(
          'relative h-full flex flex-col',
          mostPopular && 'border-brand-500 shadow-glow'
        )}
      >
        {mostPopular && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Badge>Most Popular</Badge>
          </div>
        )}

        <CardHeader>
          <CardTitle className="text-xl">{name}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>

        <CardContent className="flex-1">
          <div className="mb-6">
            {isEnterprise ? (
              <div className="text-4xl font-bold text-text-primary">Custom</div>
            ) : (
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-text-primary">
                  {isFree ? 'Free' : formatPrice(price!)}
                </span>
                {!isFree && (
                  <span className="text-text-secondary">
                    /{billingCycle === 'yearly' ? 'year' : 'month'}
                  </span>
                )}
              </div>
            )}
            {billingCycle === 'yearly' && priceMonthly && !isEnterprise && !isFree && (
              <p className="mt-1 text-sm text-success-600 dark:text-success-400">
                Save {formatPrice(priceMonthly * 2)} per year
              </p>
            )}
          </div>

          <ul className="space-y-3">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <Check className="h-5 w-5 text-success-500 shrink-0 mt-0.5" />
                <span className="text-sm text-text-secondary">{feature}</span>
              </li>
            ))}
          </ul>
        </CardContent>

        <CardFooter>
          {isEnterprise ? (
            <Button
              variant="outline"
              className="w-full"
              asChild
              onClick={handlePlanClick}
            >
              <Link href="/contact?subject=Enterprise">{cta}</Link>
            </Button>
          ) : isFree ? (
            <Button
              variant={mostPopular ? 'default' : 'outline'}
              className="w-full"
              asChild
              onClick={handlePlanClick}
            >
              <Link href={`${siteConfig.appUrl}/signup`}>{cta}</Link>
            </Button>
          ) : (
            <CheckoutButton
              plan={id}
              billingCycle={billingCycle}
              price={price!}
              variant={mostPopular ? 'default' : 'outline'}
              className="w-full"
              onClick={handlePlanClick}
            >
              {cta}
            </CheckoutButton>
          )}
        </CardFooter>
      </Card>
    </motion.div>
  );
}
