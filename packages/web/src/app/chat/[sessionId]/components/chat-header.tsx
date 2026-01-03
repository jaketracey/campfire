'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { X, Bug, Images, Gift, User, Sparkles, HelpCircle } from 'lucide-react';
import { AnimatedFlame } from '@/components/ui/animated-flame';
import Link from 'next/link';
import type { SignupTrigger } from '@/components/demo/signup-modal';

interface ChatHeaderProps {
  // User
  userRole?: string;

  // UI toggles
  showGiftsPanel: boolean;
  showDebugPanel: boolean;
  onToggleGiftsPanel: () => void;
  onToggleDebugPanel: () => void;
  onShowGallery: () => void;
  onShowSupportModal: () => void;

  // Mobile menu
  showMobileMenu: boolean;
  onToggleMobileMenu: () => void;

  // Mobile actions
  onMobileNewChat: () => void;
  onMobileGallery: () => void;
  onMobileGifts: () => void;
  onMobileDebug: () => void;
  onMobileAccount: () => void;
  onMobileClose: () => void;
  onMobileSupport: () => void;

  // Demo mode
  isDemo?: boolean;
  onRequireAuth?: (trigger: SignupTrigger) => void;
}

export function ChatHeader({
  userRole,
  showGiftsPanel,
  showDebugPanel,
  onToggleGiftsPanel,
  onToggleDebugPanel,
  onShowGallery,
  onShowSupportModal,
  showMobileMenu,
  onToggleMobileMenu,
  onMobileNewChat,
  onMobileGallery,
  onMobileGifts,
  onMobileDebug,
  onMobileAccount,
  onMobileClose,
  onMobileSupport,
  isDemo,
  onRequireAuth,
}: ChatHeaderProps) {
  const isAdmin = userRole === 'admin';

  const handleDemoGuard = (action: SignupTrigger, callback: () => void) => {
    if (isDemo && onRequireAuth) {
      onRequireAuth(action);
    } else {
      callback();
    }
  };

  return (
    <header className="px-4 py-3 flex items-center gap-4 lg:relative fixed top-0 left-0 right-0 z-50 lg:bg-transparent bg-transparent lg:backdrop-blur-none backdrop-blur-sm">
      {/* Logo - only on mobile (hidden on desktop since it's in sidebar) */}
      <Link href="/dashboard" className="lg:hidden hover:opacity-80 transition-opacity">
        <AnimatedFlame size="sm" />
      </Link>
      <div className="flex-1" />

      {/* Desktop buttons */}
      <div className="hidden lg:flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => handleDemoGuard('gallery', onShowGallery)}
          title="View Gallery"
        >
          <Images className="h-4 w-4" />
        </Button>
        <Button
          variant={showGiftsPanel ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => handleDemoGuard('gifts', onToggleGiftsPanel)}
          title="Send Gifts"
        >
          <Gift className="h-4 w-4" />
        </Button>
        {isAdmin && (
          <Button
            variant={showDebugPanel ? 'secondary' : 'ghost'}
            size="icon"
            onClick={onToggleDebugPanel}
            title="Toggle Debug Panel"
          >
            <Bug className="h-4 w-4" />
          </Button>
        )}
        {!isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onShowSupportModal}
            title="Get Help"
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
        )}
        <Link href="/dashboard">
          <Button variant="ghost" size="icon" title="Close">
            <X className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Mobile hamburger menu */}
      <div className="lg:hidden relative">
        <motion.button
          className="relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-accent/80 transition-colors"
          onClick={onToggleMobileMenu}
          title="Menu"
          whileTap={{ scale: 0.92 }}
        >
          <div className="flex flex-col justify-center items-center w-6 h-5">
            <motion.span
              className="absolute block h-0.5 w-5 bg-foreground rounded-full"
              animate={{
                rotate: showMobileMenu ? 45 : 0,
                y: showMobileMenu ? 0 : -6,
              }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            />
            <motion.span
              className="absolute block h-0.5 w-5 bg-foreground rounded-full"
              animate={{
                opacity: showMobileMenu ? 0 : 1,
                scaleX: showMobileMenu ? 0 : 1,
              }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            />
            <motion.span
              className="absolute block h-0.5 w-5 bg-foreground rounded-full"
              animate={{
                rotate: showMobileMenu ? -45 : 0,
                y: showMobileMenu ? 0 : 6,
              }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            />
          </div>
        </motion.button>

        {/* Mobile dropdown menu */}
        <AnimatePresence>
          {showMobileMenu && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="absolute right-0 top-full mt-2 bg-background/95 backdrop-blur-md border rounded-xl shadow-xl p-3 min-w-[200px] space-y-1"
            >
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 h-12 text-base px-4 text-campfire-500"
                onClick={onMobileNewChat}
              >
                <Sparkles className="h-5 w-5" />
                New Chat
              </Button>
              <div className="border-t my-2" />
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 h-12 text-base px-4"
                onClick={() => handleDemoGuard('gallery', onMobileGallery)}
              >
                <Images className="h-5 w-5" />
                Gallery
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 h-12 text-base px-4"
                onClick={() => handleDemoGuard('gifts', onMobileGifts)}
              >
                <Gift className="h-5 w-5" />
                Gifts
              </Button>
              {isAdmin && (
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 h-12 text-base px-4"
                  onClick={() => handleDemoGuard('debug', onMobileDebug)}
                >
                  <Bug className="h-5 w-5" />
                  Debug
                </Button>
              )}
              {!isAdmin && (
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 h-12 text-base px-4"
                  onClick={onMobileSupport}
                >
                  <HelpCircle className="h-5 w-5" />
                  Support
                </Button>
              )}
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 h-12 text-base px-4"
                onClick={() => handleDemoGuard('account', onMobileAccount)}
              >
                <User className="h-5 w-5" />
                Account
              </Button>
              <div className="border-t my-2" />
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 h-12 text-base px-4 text-muted-foreground"
                onClick={() => handleDemoGuard('close', onMobileClose)}
              >
                <X className="h-5 w-5" />
                Close
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
