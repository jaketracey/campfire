import type { Metadata } from 'next';
import { siteConfig, getCompanionOgImage } from '@/lib/constants';

const ogImage = getCompanionOgImage('pricing');

export const metadata: Metadata = {
  title: 'Pricing So Low It\'s Almost Suspicious - AI Companion Plans',
  description: 'EXPOSED: How to get unlimited AI companion access for less than your daily coffee. Free tier available. No credit card needed. 50,000+ users already joined. Limited time pricing before we raise it.',
  keywords: [
    'AI companion pricing',
    'cheap AI girlfriend',
    'free AI chat',
    'AI companion subscription',
    'best AI companion deal',
    'AI companion free trial',
    'virtual girlfriend cost',
    'AI companion monthly plan',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `${siteConfig.url}/pricing`,
    title: 'They Said AI Companions Would Cost $100/month. We Proved Them Wrong.',
    description: 'Unlimited voice conversations. Infinite memory. Multiple companions. All for less than a Netflix subscription. See why 50,000+ users switched to Campfire.',
    siteName: siteConfig.name,
    images: [
      {
        url: ogImage,
        width: 1024,
        height: 1024,
        alt: 'Campfire AI Companion Pricing',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Wait, this AI companion is HOW much? (Not a typo)',
    description: 'Free tier forever. Paid plans under $1/day. Voice, memory, customization - all included. The AI companion pricing that broke the internet.',
    images: [ogImage],
    creator: '@campfiredev',
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
