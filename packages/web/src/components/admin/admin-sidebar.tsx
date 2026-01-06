'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Users, Mail, BarChart3, Flame, LayoutDashboard, DollarSign, LifeBuoy, Server, GitBranch, Handshake, Target, Search, ChevronDown, Cpu, Terminal, Store, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: Route;
  icon: typeof Users;
  disabled?: boolean;
}

interface NavGroup {
  label: string;
  icon: typeof Users;
  items: NavItem[];
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/admin' as Route,
    icon: LayoutDashboard,
  },
  {
    label: 'Users',
    href: '/admin/users' as Route,
    icon: Users,
  },
  {
    label: 'Invites',
    href: '/admin/invites' as Route,
    icon: Mail,
  },
  {
    label: 'Support',
    href: '/admin/support' as Route,
    icon: LifeBuoy,
  },
  {
    label: 'Affiliates',
    href: '/admin/affiliates' as Route,
    icon: Handshake,
  },
  {
    label: 'Tenants',
    href: '/admin/tenants' as Route,
    icon: Store,
  },
  {
    label: 'Analytics',
    href: '/admin/analytics' as Route,
    icon: BarChart3,
  },
  {
    label: 'Ads',
    href: '/admin/ads' as Route,
    icon: Target,
  },
  {
    label: 'SEO Pages',
    href: '/admin/seo' as Route,
    icon: Search,
  },
  {
    label: 'Logs',
    href: '/admin/logs' as Route,
    icon: Terminal,
  },
];

const inferenceGroup: NavGroup = {
  label: 'Inference',
  icon: Cpu,
  items: [
    {
      label: 'Costs',
      href: '/admin/costs' as Route,
      icon: DollarSign,
    },
    {
      label: 'Providers',
      href: '/admin/providers' as Route,
      icon: Server,
    },
    {
      label: 'Routing',
      href: '/admin/routing' as Route,
      icon: GitBranch,
    },
    {
      label: 'Prompts',
      href: '/admin/prompts' as Route,
      icon: ScrollText,
    },
  ],
};

export function AdminSidebar() {
  const pathname = usePathname();

  const isProvidersSectionActive =
    pathname.startsWith('/admin/providers') ||
    pathname.startsWith('/admin/image-providers') ||
    pathname.startsWith('/admin/video-providers');

  const isRoutingSectionActive =
    pathname.startsWith('/admin/routing') ||
    pathname.startsWith('/admin/image-routing') ||
    pathname.startsWith('/admin/video-routing');

  // Check if any inference sub-item is active to auto-expand
  const isInferenceActive =
    inferenceGroup.items.some((item) => pathname.startsWith(item.href)) ||
    isProvidersSectionActive ||
    isRoutingSectionActive;
  const [inferenceOpen, setInferenceOpen] = useState(isInferenceActive);

  // Find where to insert the Inference group (after Invites)
  const topItems = navItems.slice(0, 4); // Dashboard, Users, Invites, Support
  const bottomItems = navItems.slice(4); // Affiliates, Analytics, Ads, SEO, Settings

  const renderNavItem = (item: NavItem) => {
    const isActive = item.href === '/admin'
      ? pathname === '/admin'
      : pathname.startsWith(item.href);
    const Icon = item.icon;

    return (
      <Link
        key={item.href}
        href={item.disabled ? '#' : item.href}
        className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all',
          isActive
            ? 'bg-campfire-500/10 text-campfire-500 border border-campfire-500/20'
            : 'text-gray-400 hover:text-white hover:bg-white/5',
          item.disabled && 'opacity-50 cursor-not-allowed hover:bg-transparent hover:text-gray-400'
        )}
        onClick={(e) => item.disabled && e.preventDefault()}
      >
        <Icon className="h-5 w-5" />
        {item.label}
        {item.disabled && (
          <span className="ml-auto text-xs text-gray-600">Soon</span>
        )}
      </Link>
    );
  };

  return (
    <aside className="w-64 border-r border-white/5 bg-zinc-950/50 flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-white/5">
        <Link href={'/admin' as Route} className="flex items-center gap-2 group">
          <Flame className="h-7 w-7 text-campfire-500 group-hover:scale-110 transition-transform" />
          <span className="font-bold font-display text-lg text-white">Admin</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {/* Top items */}
        {topItems.map(renderNavItem)}

        {/* Inference Group */}
        <div className="pt-2">
          <button
            onClick={() => setInferenceOpen(!inferenceOpen)}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all w-full',
              isInferenceActive
                ? 'bg-campfire-500/10 text-campfire-500 border border-campfire-500/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            )}
          >
            <Cpu className="h-5 w-5" />
            {inferenceGroup.label}
            <ChevronDown
              className={cn(
                'h-4 w-4 ml-auto transition-transform',
                inferenceOpen && 'rotate-180'
              )}
            />
          </button>

          {inferenceOpen && (
            <div className="ml-4 mt-1 space-y-1 border-l border-white/5 pl-2">
              {inferenceGroup.items.map((item) => {
                const isActive =
                  item.href === '/admin/providers'
                    ? isProvidersSectionActive
                    : item.href === '/admin/routing'
                      ? isRoutingSectionActive
                    : pathname.startsWith(item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                      isActive
                        ? 'bg-campfire-500/10 text-campfire-500'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom items */}
        <div className="pt-2">
          {bottomItems.map(renderNavItem)}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/5">
        <p className="text-xs text-gray-600 text-center">
          Ignite Admin Panel
        </p>
      </div>
    </aside>
  );
}
