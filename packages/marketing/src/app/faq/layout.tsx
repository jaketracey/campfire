import type { Metadata } from 'next';
import { siteConfig, getCompanionOgImage } from '@/lib/constants';

const ogImage = getCompanionOgImage('faq');

export const metadata: Metadata = {
  title: 'Everything They Don\'t Tell You About AI Companions (Honest Answers)',
  description: 'The TRUTH about AI companions that other apps hide. Can they really remember you? Is it actually private? What happens to your data? Real answers. No marketing fluff. Read before you sign up anywhere.',
  keywords: [
    'AI companion questions',
    'is AI companion safe',
    'AI girlfriend privacy',
    'AI companion data',
    'how AI companions work',
    'AI companion FAQ',
    'virtual companion questions',
    'AI chat safety',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `${siteConfig.url}/faq`,
    title: '15 Questions You\'re Afraid to Ask About AI Companions (Answered)',
    description: 'Is it weird? Can people find out? Will it judge me? We answer the awkward questions so you don\'t have to ask. 100% honest. Zero judgment.',
    siteName: siteConfig.name,
    images: [
      {
        url: ogImage,
        width: 1024,
        height: 1024,
        alt: 'Campfire AI Companion FAQ',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Your AI companion questions answered (yes, even THAT one)',
    description: 'Privacy? Memory? Cost? Judgment? We get it - you have questions. Here are brutally honest answers about AI companions.',
    images: [ogImage],
    creator: '@campfiredev',
  },
};

export default function FAQLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
