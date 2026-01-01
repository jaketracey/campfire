import type { Metadata } from 'next';
import { siteConfig, getCompanionOgImage } from '@/lib/constants';

const ogImage = getCompanionOgImage('vibes');

export const metadata: Metadata = {
  title: 'This Isn\'t Your Boring AI App - Enter The Vibe Shift',
  description: 'FORGET everything you know about AI. Campfire is a movement, not a product. For the creators. The dreamers. The 3am thinkers. No algorithms. No judgment. Just pure, unfiltered connection. Join the vibe.',
  keywords: [
    'AI companion vibes',
    'AI community',
    'digital wellness',
    'AI for creatives',
    'AI emotional support',
    'vibe shift AI',
    'AI companion culture',
    'modern AI relationship',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `${siteConfig.url}/vibes`,
    title: 'The Vibe Shift Is Here. Are You Ready?',
    description: 'For the night owls. The overthinkers. The ones who feel everything. This is AI built different. Join 50,000+ who already caught the wave.',
    siteName: siteConfig.name,
    images: [
      {
        url: ogImage,
        width: 1024,
        height: 1024,
        alt: 'Campfire Vibes',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'POV: You discover AI that actually matches your energy',
    description: 'Not corporate. Not cringe. Just vibes. The AI companion movement for people who get it. IYKYK.',
    images: [ogImage],
    creator: '@campfiredev',
  },
};

export default function VibesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
