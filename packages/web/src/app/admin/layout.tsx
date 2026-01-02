'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LogOut, UserCheck, X, Search, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { listAdminUsers, impersonateUser, type AdminUser } from '@/lib/api/admin';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, isInitialized, user, isLoading, logout } = useAuth();
  const { isImpersonating, impersonationState, startImpersonation, stopImpersonation } = useAuthStore();
  const [isCheckingRole, setIsCheckingRole] = useState(true);
  const [isImpersonateOpen, setIsImpersonateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isImpersonating_, setIsImpersonating_] = useState(false);

  useEffect(() => {
    if (!isInitialized || isLoading) return;

    if (!isAuthenticated) {
      router.push('/login?redirect=/admin');
      return;
    }

    // Check if user has admin role (but allow if impersonating since impersonationState has the real admin)
    if (user?.role !== 'admin' && !isImpersonating) {
      router.push('/dashboard');
      return;
    }

    setIsCheckingRole(false);
  }, [isInitialized, isLoading, isAuthenticated, user, router, isImpersonating]);

  // Search users for impersonation
  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim()) {
      setUsers([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await listAdminUsers({ search: query, limit: 10 });
      // Filter out admins - can't impersonate them
      setUsers(response.data.users.filter(u => u.role !== 'admin'));
    } catch (error) {
      console.error('Failed to search users:', error);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      searchUsers(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchUsers]);

  // Handle impersonation
  const handleImpersonate = async (targetUser: AdminUser) => {
    setIsImpersonating_(true);
    try {
      const response = await impersonateUser(targetUser.id);
      startImpersonation(
        {
          id: response.data.user.id,
          email: response.data.user.email,
          role: response.data.user.role,
          emailVerified: response.data.user.emailVerified,
          createdAt: response.data.user.createdAt,
        },
        {
          accessToken: response.data.tokens.accessToken,
          refreshToken: response.data.tokens.refreshToken,
          tokenType: response.data.tokens.tokenType,
          expiresIn: response.data.tokens.expiresIn,
        }
      );
      setIsImpersonateOpen(false);
      router.push('/dashboard');
    } catch (error) {
      console.error('Failed to impersonate user:', error);
    } finally {
      setIsImpersonating_(false);
    }
  };

  // Handle stop impersonation
  const handleStopImpersonation = () => {
    stopImpersonation();
    router.push('/admin');
  };

  // Handle logout
  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  // Show loading while checking auth and role
  if (!isInitialized || isLoading || isCheckingRole) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Don't render if not admin (will redirect) - but allow if impersonating
  if (!isAuthenticated || (user?.role !== 'admin' && !isImpersonating)) {
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex">
      {/* Impersonation Banner */}
      {isImpersonating && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-yellow-500 text-black py-2 px-4 flex items-center justify-center gap-4">
          <UserCheck className="h-4 w-4" />
          <span className="text-sm font-medium">
            Impersonating: {user?.email}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 bg-black/10 border-black/20 text-black hover:bg-black/20"
            onClick={handleStopImpersonation}
          >
            <X className="h-3 w-3 mr-1" />
            Exit
          </Button>
        </div>
      )}

      {/* Sidebar */}
      <AdminSidebar />

      {/* Main Content */}
      <div className={`flex-1 flex flex-col ${isImpersonating ? 'pt-10' : ''}`}>
        {/* Header */}
        <header className="h-16 border-b border-white/5 bg-zinc-950/80 backdrop-blur-lg flex items-center justify-between px-6 sticky top-0 z-50">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm font-medium">Back to App</span>
          </Link>
          <div className="flex items-center gap-4">
            {/* Impersonate Button */}
            <Dialog open={isImpersonateOpen} onOpenChange={setIsImpersonateOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                  <UserCheck className="h-4 w-4 mr-2" />
                  Impersonate
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-zinc-900 border-white/10">
                <DialogHeader>
                  <DialogTitle className="text-white">Impersonate User</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                    <Input
                      placeholder="Search by email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 bg-zinc-800 border-white/10 text-white"
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {isSearching ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                      </div>
                    ) : users.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">
                        {searchQuery ? 'No users found' : 'Type to search for users'}
                      </p>
                    ) : (
                      users.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => handleImpersonate(u)}
                          disabled={isImpersonating_}
                          className="w-full flex items-center justify-between p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-left disabled:opacity-50"
                        >
                          <div>
                            <p className="text-sm font-medium text-white">{u.email}</p>
                            <p className="text-xs text-gray-500">
                              {u.status} · {u.companionCount} companions
                            </p>
                          </div>
                          {isImpersonating_ ? (
                            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                          ) : (
                            <UserCheck className="h-4 w-4 text-gray-400" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <span className="text-sm text-gray-500">{user?.email}</span>

            {/* Logout Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-gray-400 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </Button>
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
