'use client';

import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { getStripe, getPriceId, type PricingPlan, type BillingCycle } from '@/lib/stripe';
import { trackEvent } from '@/lib/analytics';
import { siteConfig } from '@/lib/constants';

interface CheckoutButtonProps extends Omit<ButtonProps, 'onClick'> {
  plan: PricingPlan;
  billingCycle: BillingCycle;
  price: number;
  onClick?: () => void;
}

export function CheckoutButton({
  plan,
  billingCycle,
  price,
  onClick,
  children,
  ...props
}: CheckoutButtonProps) {
  const [loading, setLoading] = React.useState(false);

  const handleCheckout = async () => {
    onClick?.();
    setLoading(true);
    trackEvent.checkoutStart(plan, price);

    try {
      const stripe = await getStripe();
      if (!stripe) {
        throw new Error('Stripe not loaded');
      }

      const priceId = getPriceId(plan, billingCycle);
      if (!priceId) {
        // If no price ID configured, redirect to app signup
        window.location.href = `${siteConfig.appUrl}/signup?plan=${plan}&billing=${billingCycle}`;
        return;
      }

      // Create checkout session via API
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId,
          plan,
          billingCycle,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }

      const { sessionId } = await response.json();

      const { error } = await stripe.redirectToCheckout({ sessionId });

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Checkout error:', error);
      trackEvent.checkoutError(error instanceof Error ? error.message : 'Unknown error');
      // Fallback to app signup
      window.location.href = `${siteConfig.appUrl}/signup?plan=${plan}&billing=${billingCycle}`;
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleCheckout} loading={loading} {...props}>
      {children}
    </Button>
  );
}
