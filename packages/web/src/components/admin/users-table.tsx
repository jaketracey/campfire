'use client';

import { formatDistanceToNow } from 'date-fns';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { UserRowActions } from './user-row-actions';
import type { AdminUser, UserRole, UserStatus, UserSortField } from '@/lib/api/admin';

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
  sortBy: UserSortField;
  sortOrder: 'asc' | 'desc';
  onSort: (field: UserSortField) => void;
}

interface SortableHeaderProps {
  field: UserSortField;
  label: string;
  currentSortBy: UserSortField;
  sortOrder: 'asc' | 'desc';
  onSort: (field: UserSortField) => void;
  align?: 'left' | 'center' | 'right';
}

function SortableHeader({ field, label, currentSortBy, sortOrder, onSort, align = 'left' }: SortableHeaderProps) {
  const isActive = currentSortBy === field;
  const alignClass = align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start';

  return (
    <th className="py-4 px-4">
      <button
        onClick={() => onSort(field)}
        className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wider transition-colors ${alignClass} w-full ${
          isActive ? 'text-campfire-400' : 'text-gray-500 hover:text-gray-300'
        }`}
      >
        {label}
        {isActive ? (
          sortOrder === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        )}
      </button>
    </th>
  );
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

export function UsersTable({ users, onRefresh, sortBy, sortOrder, onSort }: UsersTableProps) {
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
            <SortableHeader
              field="email"
              label="User"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            />
            <SortableHeader
              field="status"
              label="Status"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            />
            <SortableHeader
              field="role"
              label="Role"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            />
            <SortableHeader
              field="companionCount"
              label="Companions"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
              align="center"
            />
            <SortableHeader
              field="imageCount"
              label="Images"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
              align="center"
            />
            <SortableHeader
              field="totalTokens"
              label="Tokens"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
              align="center"
            />
            <SortableHeader
              field="lastLoginAt"
              label="Last Sign In"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            />
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
