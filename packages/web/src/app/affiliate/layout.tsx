'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { Flame, LayoutDashboard, FileText, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAffiliateAuthStore } from '@/stores/affiliate-auth-store';
import { affiliateLogout } from '@/lib/api/affiliates';

interface NavItem {
  label: string;
  href: Route;
  icon: typeof LayoutDashboard;
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/affiliate/dashboard' as Route,
    icon: LayoutDashboard,
  },
  {
    label: 'Conversions',
    href: '/affiliate/conversions' as Route,
    icon: FileText,
  },
  {
    label: 'Settings',
    href: '/affiliate/settings' as Route,
    icon: Settings,
  },
];

function AffiliateSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { affiliate, token, clearSession } = useAffiliateAuthStore();

  const handleLogout = async () => {
    if (token) {
      try {
        await affiliateLogout(token);
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
    clearSession();
    router.push('/affiliate/login' as Route);
  };

  return (
    <aside className="w-64 border-r border-white/5 bg-zinc-950/50 flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-white/5">
        <Link href={'/affiliate/dashboard' as Route} className="flex items-center gap-2 group">
          <Flame className="h-7 w-7 text-campfire-500 group-hover:scale-110 transition-transform" />
          <span className="font-bold font-display text-lg text-white">Affiliate</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-campfire-500/10 text-campfire-500 border border-campfire-500/20'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User Info & Logout */}
      <div className="p-4 border-t border-white/5">
        {affiliate && (
          <div className="mb-4 px-4">
            <p className="text-sm font-medium text-white truncate">{affiliate.name}</p>
            <p className="text-xs text-gray-500 truncate">{affiliate.email}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 w-full transition-all"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}

export default function AffiliateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { affiliate, token, isInitialized } = useAffiliateAuthStore();
  const [isChecking, setIsChecking] = useState(true);

  const isLoginPage = pathname === '/affiliate/login';

  useEffect(() => {
    if (!isInitialized) return;

    // If not authenticated and not on login page, redirect to login
    if (!affiliate || !token) {
      if (!isLoginPage) {
        router.push('/affiliate/login' as Route);
      }
    } else if (isLoginPage) {
      // If authenticated and on login page, redirect to dashboard
      router.push('/affiliate/dashboard' as Route);
    }

    setIsChecking(false);
  }, [affiliate, token, isInitialized, isLoginPage, router]);

  // Show loading while checking auth
  if (!isInitialized || isChecking) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  // Login page has no sidebar
  if (isLoginPage) {
    return (
      <div className="min-h-screen bg-black">
        {children}
      </div>
    );
  }

  // Authenticated layout with sidebar
  return (
    <div className="min-h-screen bg-black flex">
      <AffiliateSidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
