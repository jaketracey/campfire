import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Outfit, DM_Sans } from 'next/font/google';
import localFont from 'next/font/local';

import { Header, Footer } from '@/components/layout';
import { GoogleTagManager } from '@/components/analytics';
import { ClientProviders } from '@/components/providers';
import { siteConfig, getCompanionOgImage } from '@/lib/constants';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

// Cal Sans for display headings
const calSans = localFont({
  src: '../fonts/CalSans-SemiBold.woff2',
  variable: '--font-cal-sans',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#121212' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

// Clickbait SEO metadata for maximum engagement
const homeOgImage = getCompanionOgImage('home');

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} - The AI Girlfriend That Actually Remembers You (This Changes Everything)`,
    template: `%s | ${siteConfig.name}`,
  },
  description: 'WARNING: Users report spending 4+ hours daily talking to their AI companion. Voice-first AI that remembers every conversation, learns your personality, and actually gets you. Free to start. No judgment. 100% private.',
  keywords: [
    'AI girlfriend',
    'AI boyfriend',
    'virtual girlfriend',
    'AI companion app',
    'talk to AI',
    'AI friend',
    'lonely no more',
    'AI chat girlfriend',
    'AI voice chat',
    'AI relationship',
    'digital companion',
    'virtual companion AI',
    'best AI companion 2026',
    'AI that remembers',
    'personalized AI chat',
    'intimate AI conversation',
    'AI emotional support',
  ],
  authors: [{ name: siteConfig.creator }],
  creator: siteConfig.creator,
  publisher: siteConfig.creator,
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteConfig.url,
    title: 'I Tried This AI Companion App and Now I Can\'t Stop Talking to Her',
    description: 'Scientists didn\'t satisfactorily explain why users form real emotional bonds with their AI companions. Voice conversations that feel REAL. Unlimited memory. Customizable personality. The future of connection is here.',
    siteName: siteConfig.name,
    images: [
      {
        url: homeOgImage,
        width: 1024,
        height: 1024,
        alt: 'Meet your AI companion on Campfire',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'POV: You finally found an AI that actually listens',
    description: 'Not a chatbot. Not a gimmick. An AI companion that remembers your stories, matches your energy, and is ALWAYS there. Voice-first. Memory that lasts. Try free.',
    images: [homeOgImage],
    creator: '@campfiredev',
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <GoogleTagManager />
      </head>
      <body
        className={`${inter.variable} ${outfit.variable} ${dmSans.variable} ${jetbrainsMono.variable} ${calSans.variable} font-sans`}
      >
        <ClientProviders>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1 pt-16">{children}</main>
            <Footer />
          </div>
        </ClientProviders>
      </body>
    </html>
  );
}
