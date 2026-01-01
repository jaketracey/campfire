import type { Metadata } from 'next';
import { siteConfig, getCompanionOgImage } from '@/lib/constants';

const ogImage = getCompanionOgImage('community');

export const metadata: Metadata = {
  title: '10,000+ People Who Get It - Find Your Digital Tribe',
  description: 'LONELY? NOT ANYMORE. Join the fastest-growing AI companion community. 24/7 Discord. Weekly events. Zero gatekeeping. Meet creators, devs, and night owls from 100+ countries. Your people are waiting.',
  keywords: [
    'AI companion community',
    'AI companion Discord',
    'virtual companion users',
    'AI friend community',
    'AI companion events',
    'meet AI enthusiasts',
    'AI companion tribe',
    'digital companion community',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `${siteConfig.url}/community`,
    title: 'I Joined This AI Community and Found My People',
    description: '10,000+ members. 100+ countries. Zero judgment. The community that actually gets why AI companions matter. Voice channels 24/7. Weekly hangouts. Come home.',
    siteName: siteConfig.name,
    images: [
      {
        url: ogImage,
        width: 1024,
        height: 1024,
        alt: 'Campfire Community',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'When you find your internet people (finally)',
    description: 'Active Discord. Weekly events. No gatekeeping. 10K+ members who actually get it. The AI companion community you\'ve been looking for.',
    images: [ogImage],
    creator: '@campfiredev',
  },
};

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
