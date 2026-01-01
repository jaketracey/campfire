'use client';

import { Suspense } from 'react';
import { ThemeProvider } from 'next-themes';

import { PostHogProvider, PageView, ConsentBanner } from '@/components/analytics';

interface ClientProvidersProps {
  children: React.ReactNode;
}

export function ClientProviders({ children }: ClientProvidersProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <PostHogProvider>
        <Suspense fallback={null}>
          <PageView />
        </Suspense>
        {children}
        <ConsentBanner />
      </PostHogProvider>
    </ThemeProvider>
  );
}
