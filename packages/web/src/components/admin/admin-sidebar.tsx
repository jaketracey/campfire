'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Users, Mail, Settings, BarChart3, Flame, FlaskConical, DollarSign, LifeBuoy, Server, GitBranch, Handshake } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: Route;
  icon: typeof Users;
  disabled?: boolean;
}

const navItems: NavItem[] = [
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
    label: 'Orchestration',
    href: '/admin/orchestration' as Route,
    icon: FlaskConical,
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
    label: 'Costs',
    href: '/admin/costs' as Route,
    icon: DollarSign,
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
    label: 'Analytics',
    href: '/admin/analytics' as Route,
    icon: BarChart3,
  },
  {
    label: 'Settings',
    href: '/admin/settings' as Route,
    icon: Settings,
    disabled: true,
  },
];

export function AdminSidebar() {
  const pathname = usePathname();

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
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
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
        })}
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
