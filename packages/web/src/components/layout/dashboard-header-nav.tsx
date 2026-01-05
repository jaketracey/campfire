'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { User, LogOut, Coins } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { useAuth } from '@/hooks/use-auth';
import { getTokenBalance } from '@/lib/api/tokens';

export function DashboardHeaderNav() {
  const { logout, isAuthenticated } = useAuth();
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);

  // Fetch token balance
  const fetchBalance = useCallback(() => {
    if (isAuthenticated) {
      getTokenBalance()
        .then((data) => setTokenBalance(data?.balance ?? 0))
        .catch(() => setTokenBalance(0));
    }
  }, [isAuthenticated]);

  // Initial fetch
  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Refresh when page becomes visible (e.g., after admin grants tokens or switching tabs)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchBalance();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchBalance]);

  return (
    <div className="flex items-center gap-2">
      {/* Tokens Button - Poker Machine Style */}
      <Link href={'/account/tokens' as Route}>
        <motion.div
          className="relative flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-amber-950 font-bold text-sm shadow-[0_0_20px_rgba(251,191,36,0.4)] border border-amber-300/50 overflow-hidden cursor-pointer"
          whileHover={{
            scale: 1.05,
            boxShadow: '0 0 30px rgba(251,191,36,0.6)',
          }}
          whileTap={{ scale: 0.95 }}
          animate={{
            boxShadow: [
              '0 0 20px rgba(251,191,36,0.4)',
              '0 0 35px rgba(251,191,36,0.7)',
              '0 0 20px rgba(251,191,36,0.4)',
            ],
          }}
          transition={{
            boxShadow: {
              duration: 2,
              repeat: Infinity,
              repeatDelay: 5,
              ease: 'easeInOut',
            },
          }}
        >
          {/* Shimmer effect that plays periodically like a slot machine */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent -skew-x-12"
            initial={{ x: '-200%' }}
            animate={{ x: ['200%', '200%', '-200%'] }}
            transition={{
              duration: 0.8,
              times: [0, 0.9, 1],
              repeat: Infinity,
              repeatDelay: 4,
              ease: 'easeInOut',
            }}
          />
          {/* Coin icon with periodic wiggle */}
          <motion.div
            animate={{
              rotate: [0, -10, 10, -10, 10, 0],
              scale: [1, 1.1, 1.1, 1.1, 1.1, 1],
            }}
            transition={{
              duration: 0.5,
              repeat: Infinity,
              repeatDelay: 6,
              ease: 'easeInOut',
            }}
          >
            <Coins className="h-4 w-4 sm:h-5 sm:w-5 relative z-10" />
          </motion.div>
          <span className="relative z-10 hidden sm:inline">
            {tokenBalance !== null ? tokenBalance.toLocaleString() : '...'}
          </span>
          <span className="relative z-10 sm:hidden">
            {tokenBalance !== null ? (tokenBalance >= 1000 ? `${(tokenBalance / 1000).toFixed(1)}k` : tokenBalance) : '...'}
          </span>
        </motion.div>
      </Link>

      <Link
        href={'/account' as Route}
        className="flex items-center gap-2 px-2 sm:px-4 py-2 rounded-full bg-white/[0.05] border border-white/10 hover:bg-white/[0.1] hover:border-white/20 transition-all group"
      >
        <User className="h-5 w-5 text-gray-400 group-hover:text-white transition-colors" />
        <span className="hidden sm:inline text-sm font-medium text-gray-400 group-hover:text-white transition-colors">Account</span>
      </Link>
      <button
        onClick={logout}
        className="flex items-center gap-2 px-2 sm:px-4 py-2 rounded-full bg-white/[0.05] border border-white/10 hover:bg-red-500/20 hover:border-red-500/30 transition-all group"
      >
        <LogOut className="h-5 w-5 text-gray-400 group-hover:text-red-400 transition-colors" />
        <span className="hidden sm:inline text-sm font-medium text-gray-400 group-hover:text-red-400 transition-colors">Logout</span>
      </button>
    </div>
  );
}
