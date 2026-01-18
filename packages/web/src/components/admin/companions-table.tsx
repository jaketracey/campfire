'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { formatDistanceToNow } from 'date-fns';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { AdminCompanion, CompanionSortField, CompanionStatus } from '@/lib/api/admin-companions';

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

interface CompanionsTableProps {
  companions: AdminCompanion[];
  sortBy: CompanionSortField;
  sortOrder: 'asc' | 'desc';
  onSort: (field: CompanionSortField) => void;
}

interface SortableHeaderProps {
  field: CompanionSortField;
  label: string;
  currentSortBy: CompanionSortField;
  sortOrder: 'asc' | 'desc';
  onSort: (field: CompanionSortField) => void;
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

function StatusBadge({ status }: { status: CompanionStatus }) {
  const variants: Record<CompanionStatus, { label: string; className: string }> = {
    draft: { label: 'Draft', className: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
    active: { label: 'Active', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
    archived: { label: 'Archived', className: 'bg-red-500/10 text-red-500 border-red-500/20' },
  };

  const variant = variants[status];

  return (
    <Badge variant="outline" className={variant.className}>
      {variant.label}
    </Badge>
  );
}

export function CompanionsTable({ companions, sortBy, sortOrder, onSort }: CompanionsTableProps) {
  if (companions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No companions found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/5">
            <SortableHeader
              field="name"
              label="Companion"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            />
            <SortableHeader
              field="ownerEmail"
              label="Owner"
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
              field="sessionCount"
              label="Sessions"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
              align="center"
            />
            <SortableHeader
              field="totalMessages"
              label="Messages"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
              align="center"
            />
            <SortableHeader
              field="totalCostUsd"
              label="Cost"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
              align="right"
            />
            <SortableHeader
              field="createdAt"
              label="Created"
              currentSortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {companions.map((companion) => (
            <tr
              key={companion.id}
              className="hover:bg-white/[0.02] transition-colors"
            >
              <td className="py-4 px-4">
                <Link
                  href={`/admin/companions/${companion.id}` as Route}
                  className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                >
                  <Avatar className="h-10 w-10">
                    {companion.avatarUrl ? (
                      <AvatarImage
                        src={companion.avatarUrl}
                        alt={companion.name}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="bg-campfire-500/10 text-campfire-500 font-medium">
                      {companion.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium text-white hover:text-campfire-400 transition-colors">
                      {companion.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {companion.imageCount} images &middot; {companion.entityCount} entities
                    </p>
                  </div>
                </Link>
              </td>
              <td className="py-4 px-4">
                <Link
                  href={`/admin/users?search=${encodeURIComponent(companion.ownerEmail)}` as Route}
                  className="text-gray-400 hover:text-white text-sm transition-colors"
                >
                  {companion.ownerEmail}
                </Link>
              </td>
              <td className="py-4 px-4">
                <StatusBadge status={companion.status} />
              </td>
              <td className="py-4 px-4 text-center">
                <span className="text-white font-medium">{formatNumber(companion.sessionCount)}</span>
              </td>
              <td className="py-4 px-4 text-center">
                <span className="text-white font-medium">{formatNumber(companion.totalMessages)}</span>
              </td>
              <td className="py-4 px-4 text-right">
                <span className="text-white font-medium">{formatCurrency(companion.totalCostUsd)}</span>
              </td>
              <td className="py-4 px-4">
                <span className="text-gray-400 text-sm">
                  {formatDistanceToNow(new Date(companion.createdAt), { addSuffix: true })}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
