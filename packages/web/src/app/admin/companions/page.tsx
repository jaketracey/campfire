'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CompanionsTable } from '@/components/admin/companions-table';
import {
  listAdminCompanions,
  type AdminCompanion,
  type CompanionStatus,
  type CompanionSortField,
} from '@/lib/api/admin-companions';

const PAGE_SIZE = 20;

export default function AdminCompanionsPage() {
  const [companions, setCompanions] = useState<AdminCompanion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CompanionStatus | 'all'>('all');
  const [sortBy, setSortBy] = useState<CompanionSortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset to first page when filters change
  useEffect(() => {
    setOffset(0);
  }, [statusFilter, sortBy, sortOrder]);

  const fetchCompanions = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await listAdminCompanions({
        limit: PAGE_SIZE,
        offset,
        search: debouncedSearch || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        sortBy,
        sortOrder,
      });
      setCompanions(response.data.companions);
      setHasMore(response.data.hasMore);
    } catch (error) {
      console.error('Failed to fetch companions:', error);
    } finally {
      setIsLoading(false);
    }
  }, [offset, debouncedSearch, statusFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchCompanions();
  }, [fetchCompanions]);

  const handleSort = (field: CompanionSortField) => {
    if (field === sortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - PAGE_SIZE));
  };

  const handleNextPage = () => {
    if (hasMore) {
      setOffset(offset + PAGE_SIZE);
    }
  };

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-white">Companions</h1>
          <p className="text-gray-400 mt-1">View and manage all companions in the system</p>
        </div>
      </div>

      {/* Main Card */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="border-b border-white/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-gray-600"
              />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as CompanionStatus | 'all')}
              >
                <SelectTrigger className="w-32 bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>

              {/* Refresh */}
              <Button
                variant="outline"
                size="icon"
                onClick={fetchCompanions}
                disabled={isLoading}
                className="border-white/10 hover:bg-white/10"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-pulse text-gray-500">Loading companions...</div>
            </div>
          ) : (
            <CompanionsTable
              companions={companions}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
            />
          )}
        </CardContent>

        {/* Pagination */}
        {!isLoading && companions.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
            <p className="text-sm text-gray-500">
              Page {currentPage}
              {hasMore ? '+' : ''} &middot; Showing {companions.length} companions
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevPage}
                disabled={offset === 0}
                className="border-white/10 hover:bg-white/10"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={!hasMore}
                className="border-white/10 hover:bg-white/10"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
