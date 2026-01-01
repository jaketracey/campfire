import type { Metadata } from 'next';
import { siteConfig, getCompanionOgImage } from '@/lib/constants';

const ogImage = getCompanionOgImage('terms');

export const metadata: Metadata = {
  title: 'Terms Written By Humans (Not Lawyers Trying to Trick You)',
  description: 'READABLE terms of service. No buried clauses. No gotchas. Just clear rules so we all know what\'s up. Takes 5 minutes to read. We promise it won\'t put you to sleep.',
  keywords: [
    'AI companion terms',
    'Campfire terms of service',
    'AI companion rules',
    'virtual companion agreement',
    'AI companion TOS',
    'Campfire legal',
    'AI companion guidelines',
    'fair AI terms',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `${siteConfig.url}/terms`,
    title: 'Terms of Service You Can Actually Read (Revolutionary)',
    description: 'Plain English. No tricks. No gotchas. The terms of service experience you never knew you needed.',
    siteName: siteConfig.name,
    images: [
      {
        url: ogImage,
        width: 1024,
        height: 1024,
        alt: 'Campfire Terms of Service',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Terms so fair you\'ll wonder what\'s the catch (there isn\'t one)',
    description: 'Written for humans. Clear rules. No legal trickery. Because you deserve to know what you\'re agreeing to.',
    images: [ogImage],
    creator: '@campfiredev',
  },
};

export default function TermsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
