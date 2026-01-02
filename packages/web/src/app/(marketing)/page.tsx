'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Flame } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

/**
 * Homepage - redirects to demo chat or dashboard
 *
 * - Unauthenticated users → /chat/demo
 * - Authenticated users → /dashboard
 */
export default function HomePage() {
  const router = useRouter();
  const { user, isInitialized } = useAuth();

  useEffect(() => {
    if (isInitialized) {
      router.replace(user ? '/dashboard' : '/chat/demo');
    }
  }, [user, isInitialized, router]);

  // Show Campfire logo while checking auth
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Flame className="h-24 w-24 text-primary animate-pulse" />
    </div>
  );
}
