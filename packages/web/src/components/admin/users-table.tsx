'use client';

import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { UserRowActions } from './user-row-actions';
import type { AdminUser, UserRole, UserStatus } from '@/lib/api/admin';

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

interface UsersTableProps {
  users: AdminUser[];
  onRefresh: () => void;
}

function StatusBadge({ status }: { status: UserStatus }) {
  const variants: Record<UserStatus, { label: string; className: string }> = {
    active: { label: 'Active', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
    suspended: { label: 'Suspended', className: 'bg-red-500/10 text-red-500 border-red-500/20' },
    deleted: { label: 'Deleted', className: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  };

  const variant = variants[status];

  return (
    <Badge variant="outline" className={variant.className}>
      {variant.label}
    </Badge>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  if (role === 'admin') {
    return (
      <Badge variant="outline" className="bg-campfire-500/10 text-campfire-500 border-campfire-500/20">
        Admin
      </Badge>
    );
  }
  return null;
}

export function UsersTable({ users, onRefresh }: UsersTableProps) {
  if (users.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No users found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/5">
            <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              User
            </th>
            <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Role
            </th>
            <th className="text-center py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Companions
            </th>
            <th className="text-center py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Images
            </th>
            <th className="text-center py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Tokens
            </th>
            <th className="text-left py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Last Sign In
            </th>
            <th className="text-right py-4 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {users.map((user) => (
            <tr
              key={user.id}
              className="hover:bg-white/[0.02] transition-colors"
            >
              <td className="py-4 px-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-white/5 text-white font-medium">
                      {user.email.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium text-white">{user.email}</p>
                    <p className="text-xs text-gray-500">
                      {user.loginCount} sign-in{user.loginCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </td>
              <td className="py-4 px-4">
                <StatusBadge status={user.status} />
              </td>
              <td className="py-4 px-4">
                <RoleBadge role={user.role} />
              </td>
              <td className="py-4 px-4 text-center">
                <span className="text-white font-medium">{user.companionCount}</span>
              </td>
              <td className="py-4 px-4 text-center">
                <span className="text-white font-medium">{user.imageCount.toLocaleString()}</span>
              </td>
              <td className="py-4 px-4 text-center">
                <span className="text-white font-medium">{formatTokens(user.totalTokens)}</span>
              </td>
              <td className="py-4 px-4">
                {user.lastLoginAt ? (
                  <span className="text-gray-400 text-sm">
                    {formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })}
                  </span>
                ) : (
                  <span className="text-gray-600 text-sm">Never</span>
                )}
              </td>
              <td className="py-4 px-4 text-right">
                <UserRowActions user={user} onActionComplete={onRefresh} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
