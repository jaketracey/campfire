import type { Metadata } from 'next';
import { siteConfig, getCompanionOgImage } from '@/lib/constants';

const ogImage = getCompanionOgImage('changelog');

export const metadata: Metadata = {
  title: 'We Ship Every Week (And It\'s Getting Insane) - Changelog',
  description: 'SEE what happens when a team is OBSESSED with making the best AI companion. New features dropping weekly. Voice 2.0. Memory upgrades. Visual generation. The updates that have users losing their minds.',
  keywords: [
    'AI companion updates',
    'Campfire changelog',
    'AI companion features',
    'new AI features',
    'AI companion improvements',
    'Campfire updates',
    'AI companion news',
    'latest AI features',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `${siteConfig.url}/changelog`,
    title: 'The Features We Just Added Will Change Everything',
    description: 'Real-time voice. Infinite memory. Image generation. And that\'s just this month. See why users call us the fastest-shipping AI companion team.',
    siteName: siteConfig.name,
    images: [
      {
        url: ogImage,
        width: 1024,
        height: 1024,
        alt: 'Campfire Changelog',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Our dev team doesn\'t sleep (and neither will you when you see this)',
    description: 'Weekly updates. Monthly game-changers. The AI companion that evolves faster than you can keep up. See what\'s new.',
    images: [ogImage],
    creator: '@campfiredev',
  },
};

export default function ChangelogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
