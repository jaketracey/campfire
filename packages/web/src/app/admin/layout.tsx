'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Flame, ArrowLeft, Users, Mail, Settings } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { AdminSidebar } from '@/components/admin/admin-sidebar';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, isInitialized, user, isLoading } = useAuth();
  const [isCheckingRole, setIsCheckingRole] = useState(true);

  useEffect(() => {
    if (!isInitialized || isLoading) return;

    if (!isAuthenticated) {
      router.push('/login?redirect=/admin');
      return;
    }

    // Check if user has admin role
    if (user?.role !== 'admin') {
      router.push('/dashboard');
      return;
    }

    setIsCheckingRole(false);
  }, [isInitialized, isLoading, isAuthenticated, user, router]);

  // Show loading while checking auth and role
  if (!isInitialized || isLoading || isCheckingRole) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Don't render if not admin (will redirect)
  if (!isAuthenticated || user?.role !== 'admin') {
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex">
      {/* Sidebar */}
      <AdminSidebar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-16 border-b border-white/5 bg-zinc-950/80 backdrop-blur-lg flex items-center justify-between px-6 sticky top-0 z-50">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm font-medium">Back to App</span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2 group">
              <Flame className="h-6 w-6 text-campfire-500" />
              <span className="font-bold font-display text-white">
                Campfire <span className="text-campfire-500">Admin</span>
              </span>
            </Link>
          </div>
          <div className="text-sm text-gray-500">
            {user?.email}
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
