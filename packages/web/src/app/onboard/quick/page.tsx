'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/use-auth';
import { WelcomeTransition } from '@/components/auth/welcome-transition';
import { QuickStart } from '@/components/onboarding/quick-start';

export default function QuickStartPage() {
  const router = useRouter();
  const { isAuthenticated, isInitialized, isLoading: authLoading } = useAuth();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (isInitialized && !authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isInitialized, authLoading, isAuthenticated, router]);

  // Show loading while checking auth
  if (!isInitialized || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a]">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  return (
    <WelcomeTransition>
      <div className="relative min-h-screen w-full overflow-hidden text-white flex flex-col font-sans">
        {/* Main Content Area */}
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 md:p-8">
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95, filter: 'blur(20px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            transition={{
              duration: 0.6,
              ease: [0.22, 1, 0.36, 1],
              opacity: { duration: 0.4 },
            }}
            className="w-full max-w-4xl relative z-20"
            data-hides-logo
          >
            <QuickStart onBack={() => router.push('/onboard')} />
          </motion.div>
        </main>
      </div>
    </WelcomeTransition>
  );
}
