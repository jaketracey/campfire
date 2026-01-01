import type { Metadata } from 'next';
import { siteConfig, getCompanionOgImage } from '@/lib/constants';

const ogImage = getCompanionOgImage('acceptable-use');

export const metadata: Metadata = {
  title: 'The Rules (Basically: Don\'t Be Terrible) - Acceptable Use',
  description: 'SHORT version: Be cool. Don\'t be creepy. Keep it legal. That\'s basically it. Full version below for the details. We keep Campfire safe so everyone can vibe.',
  keywords: [
    'AI companion rules',
    'Campfire acceptable use',
    'AI companion guidelines',
    'safe AI usage',
    'AI companion policy',
    'virtual companion rules',
    'AI chat guidelines',
    'responsible AI use',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `${siteConfig.url}/acceptable-use`,
    title: 'How to Not Get Banned (It\'s Pretty Simple)',
    description: 'Don\'t be creepy. Don\'t do illegal stuff. Don\'t ruin it for everyone else. That\'s the TL;DR. We keep Campfire safe and fun.',
    siteName: siteConfig.name,
    images: [
      {
        url: ogImage,
        width: 1024,
        height: 1024,
        alt: 'Campfire Acceptable Use Policy',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Rules so reasonable you\'ll be like "that\'s it?"',
    description: 'Be cool. Be legal. Be respectful. That\'s basically our whole acceptable use policy. We keep it simple.',
    images: [ogImage],
    creator: '@campfiredev',
  },
};

export default function AcceptableUseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
