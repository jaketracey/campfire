import type { Metadata } from 'next';
import { Inter, Outfit, DM_Sans } from 'next/font/google';
import { Suspense } from 'react';
import { ClientProviders } from '@/components/providers/client-providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
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

export const metadata: Metadata = {
  title: 'Campfire - Your AI Companion',
  description: 'Create and connect with your personalized AI companion',
  icons: {
    icon: [
      { url: '/favicon/favicon.ico', sizes: 'any' },
      { url: '/favicon/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    apple: [
      { url: '/favicon/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/favicon/site.webmanifest',
};

function GlobalFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${outfit.variable} ${dmSans.variable} font-sans antialiased uppercase-none`}>
        <Suspense fallback={<GlobalFallback />}>
          <ClientProviders>{children}</ClientProviders>
        </Suspense>
      </body>
    </html>
  );
}
