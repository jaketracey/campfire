'use client';

import { User, LogOut } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { useAuth } from '@/hooks/use-auth';

export function DashboardHeaderNav() {
  const { logout } = useAuth();

  return (
    <div className="flex items-center gap-2">
      <Link
        href={'/account' as Route}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.05] border border-white/10 hover:bg-white/[0.1] hover:border-white/20 transition-all group"
      >
        <User className="h-5 w-5 text-gray-400 group-hover:text-white transition-colors" />
        <span className="text-sm font-medium text-gray-400 group-hover:text-white transition-colors">Account</span>
      </Link>
      <button
        onClick={logout}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.05] border border-white/10 hover:bg-red-500/20 hover:border-red-500/30 transition-all group"
      >
        <LogOut className="h-5 w-5 text-gray-400 group-hover:text-red-400 transition-colors" />
        <span className="text-sm font-medium text-gray-400 group-hover:text-red-400 transition-colors">Logout</span>
      </button>
    </div>
  );
}
