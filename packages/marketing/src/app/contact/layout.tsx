import type { Metadata } from 'next';
import { siteConfig, getCompanionOgImage } from '@/lib/constants';

const ogImage = getCompanionOgImage('contact');

export const metadata: Metadata = {
  title: 'Real Humans. Real Fast Responses. Seriously.',
  description: 'ACTUAL humans answer within 24 hours. Not bots. Not templates. Not "we\'ll get back to you eventually." Whether you have feedback, questions, or just want to say hi - we\'re here. Promise.',
  keywords: [
    'contact Campfire',
    'AI companion support',
    'Campfire help',
    'AI companion feedback',
    'reach Campfire team',
    'AI companion customer service',
    'Campfire support',
    'AI companion assistance',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `${siteConfig.url}/contact`,
    title: 'We Actually Read Every Message (Wild, We Know)',
    description: 'Feedback? Ideas? Just wanna chat? Real humans. Real responses. Usually within 24 hours. Sometimes faster if we\'re caffeinated.',
    siteName: siteConfig.name,
    images: [
      {
        url: ogImage,
        width: 1024,
        height: 1024,
        alt: 'Contact Campfire',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'A company that responds? In THIS economy?',
    description: 'Real humans. Real fast. No chatbots answering your support tickets. We actually want to hear from you. Revolutionary, we know.',
    images: [ogImage],
    creator: '@campfiredev',
  },
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
