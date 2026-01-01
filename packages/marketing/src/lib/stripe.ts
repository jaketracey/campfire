import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null>;

export const getStripe = () => {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      console.warn('Stripe publishable key not found');
      return Promise.resolve(null);
    }
    stripePromise = loadStripe(key);
  }
  return stripePromise;
};

export type PricingPlan = 'starter' | 'pro' | 'enterprise';
export type BillingCycle = 'monthly' | 'yearly';

interface PriceConfig {
  [key: string]: string | undefined;
}

const priceIds: Record<PricingPlan, Record<BillingCycle, string | undefined>> = {
  starter: {
    monthly: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_MONTHLY,
    yearly: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_YEARLY,
  },
  pro: {
    monthly: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY,
    yearly: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY,
  },
  enterprise: {
    monthly: process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE_MONTHLY,
    yearly: process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE_YEARLY,
  },
};

export const getPriceId = (plan: PricingPlan, billingCycle: BillingCycle): string | undefined => {
  return priceIds[plan]?.[billingCycle];
};

export const formatPrice = (amount: number, currency: string = 'USD'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const calculateYearlySavings = (monthlyPrice: number): number => {
  const yearlyPrice = monthlyPrice * 10; // 2 months free
  const regularYearlyPrice = monthlyPrice * 12;
  return regularYearlyPrice - yearlyPrice;
};

export const getSubscriptionManagementUrl = (): string => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.campfire.dev';
  return `${appUrl}/settings/billing`;
};
