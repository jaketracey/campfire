import type { Metadata } from 'next';
import { siteConfig, getCompanionOgImage } from '@/lib/constants';

const ogImage = getCompanionOgImage('privacy');

export const metadata: Metadata = {
  title: 'Your Secrets Are Actually Safe (We Mean It) - Privacy Policy',
  description: 'FINALLY an AI company that doesn\'t sell your data. Encrypted. Private. Your conversations stay YOURS. Read exactly what we collect (spoiler: way less than you think). Transparency you can actually trust.',
  keywords: [
    'AI companion privacy',
    'is AI companion private',
    'AI chat encryption',
    'virtual companion data',
    'AI companion data policy',
    'private AI chat',
    'secure AI companion',
    'AI companion confidential',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `${siteConfig.url}/privacy`,
    title: 'Plot Twist: An AI Company That Doesn\'t Sell Your Data',
    description: 'End-to-end encrypted. No data selling. You control everything. Read our privacy policy and be shocked by how normal it is.',
    siteName: siteConfig.name,
    images: [
      {
        url: ogImage,
        width: 1024,
        height: 1024,
        alt: 'Campfire Privacy Policy',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Our privacy policy is so fair you\'ll think it\'s fake',
    description: 'Your data = yours. We don\'t sell it. We don\'t share it. We barely even look at it. Privacy done right.',
    images: [ogImage],
    creator: '@campfiredev',
  },
};

export default function PrivacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
