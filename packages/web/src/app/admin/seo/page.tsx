'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Search,
  Plus,
  ExternalLink,
  MoreHorizontal,
  Sparkles,
  Eye,
  Trash2,
  Globe,
  FileText,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  listSeoPages,
  listAvailableCompanions,
  createSeoPage,
  deleteSeoPage,
  regenerateSeoPage,
  publishSeoPage,
  unpublishSeoPage,
  type SeoPageListItem,
  type SeoPageStatus,
  type AvailableCompanion,
} from '@/lib/api/admin-seo';
import { formatDistanceToNow, format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<SeoPageStatus, string> = {
  draft: 'Draft',
  generating: 'Generating',
  published: 'Published',
  archived: 'Archived',
};

function getStatusBadgeClasses(status: SeoPageStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-500/20 text-gray-400 border-0';
    case 'generating':
      return 'bg-blue-500/20 text-blue-400 border-0 animate-pulse';
    case 'published':
      return 'bg-green-500/20 text-green-400 border-0';
    case 'archived':
      return 'bg-amber-500/20 text-amber-400 border-0';
    default:
      return 'bg-gray-500/20 text-gray-400 border-0';
  }
}

export default function AdminSeoPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [pages, setPages] = useState<SeoPageListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SeoPageStatus | 'all'>('all');

  // Create dialog state
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [availableCompanions, setAvailableCompanions] = useState<AvailableCompanion[]>([]);
  const [isLoadingCompanions, setIsLoadingCompanions] = useState(false);
  const [selectedCompanionId, setSelectedCompanionId] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);

  // Delete dialog state
  const [deletePageId, setDeletePageId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchPages = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await listSeoPages({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setPages(response.pages);
      setHasMore(response.hasMore);
      setTotal(response.total);
    } catch (error) {
      console.error('Failed to fetch pages:', error);
      toast({
        title: 'Error',
        description: 'Failed to load SEO pages',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, toast]);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  const fetchAvailableCompanions = async () => {
    setIsLoadingCompanions(true);
    try {
      const response = await listAvailableCompanions({ limit: 100 });
      setAvailableCompanions(response.companions);
    } catch (error) {
      console.error('Failed to fetch companions:', error);
      toast({
        title: 'Error',
        description: 'Failed to load available companions',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingCompanions(false);
    }
  };

  const handleOpenCreateDialog = () => {
    setIsCreateDialogOpen(true);
    fetchAvailableCompanions();
  };

  const handleCreate = async () => {
    if (!selectedCompanionId) return;

    setIsCreating(true);
    try {
      const result = await createSeoPage(selectedCompanionId, true);
      toast({
        title: 'SEO Page Created',
        description: result.message,
      });
      setIsCreateDialogOpen(false);
      setSelectedCompanionId('');
      fetchPages();
    } catch (error) {
      console.error('Failed to create page:', error);
      toast({
        title: 'Error',
        description: 'Failed to create SEO page',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deletePageId) return;

    setIsDeleting(true);
    try {
      await deleteSeoPage(deletePageId);
      toast({
        title: 'SEO Page Deleted',
        description: 'The page has been removed.',
      });
      setDeletePageId(null);
      fetchPages();
    } catch (error) {
      console.error('Failed to delete page:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete SEO page',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRegenerate = async (pageId: string) => {
    try {
      await regenerateSeoPage(pageId);
      toast({
        title: 'Regeneration Started',
        description: 'AI is generating new content for this page.',
      });
      fetchPages();
    } catch (error) {
      console.error('Failed to regenerate:', error);
      toast({
        title: 'Error',
        description: 'Failed to start regeneration',
        variant: 'destructive',
      });
    }
  };

  const handlePublish = async (pageId: string) => {
    try {
      await publishSeoPage(pageId);
      toast({
        title: 'Page Published',
        description: 'The page is now live and visible to search engines.',
      });
      fetchPages();
    } catch (error) {
      console.error('Failed to publish:', error);
      toast({
        title: 'Error',
        description: 'Failed to publish page',
        variant: 'destructive',
      });
    }
  };

  const handleUnpublish = async (pageId: string) => {
    try {
      await unpublishSeoPage(pageId);
      toast({
        title: 'Page Unpublished',
        description: 'The page has been reverted to draft.',
      });
      fetchPages();
    } catch (error) {
      console.error('Failed to unpublish:', error);
      toast({
        title: 'Error',
        description: 'Failed to unpublish page',
        variant: 'destructive',
      });
    }
  };

  const handlePrevPage = () => {
    setPage(Math.max(1, page - 1));
  };

  const handleNextPage = () => {
    if (hasMore) {
      setPage(page + 1);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-white">SEO Pages</h1>
          <p className="text-gray-400 mt-1">Generate and manage companion profile pages for search engines</p>
        </div>
        <Button
          onClick={handleOpenCreateDialog}
          className="bg-campfire-500 hover:bg-campfire-600"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create SEO Page
        </Button>
      </div>

      {/* Main Card */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="border-b border-white/5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-gray-400">
                <FileText className="h-4 w-4" />
                <span className="text-sm">
                  {total} page{total !== 1 ? 's' : ''}
                </span>
              </div>
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as SeoPageStatus | 'all');
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-32 bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10">
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="generating">Generating</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                  placeholder="Search by name or slug..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64 bg-white/5 border-white/10 text-white placeholder:text-gray-500"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={fetchPages}
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
              <div className="animate-pulse text-gray-500">Loading pages...</div>
            </div>
          ) : pages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <Search className="h-12 w-12 mb-4 opacity-50" />
              <p>No SEO pages found</p>
              <p className="text-sm mt-1">
                {debouncedSearch || statusFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Create your first SEO page to get started'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-gray-500">Companion</TableHead>
                  <TableHead className="text-gray-500">Slug</TableHead>
                  <TableHead className="text-gray-500">Status</TableHead>
                  <TableHead className="text-gray-500">Version</TableHead>
                  <TableHead className="text-gray-500">Updated</TableHead>
                  <TableHead className="text-gray-500 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pages.map((seoPage) => (
                  <TableRow
                    key={seoPage.id}
                    className="border-white/5 hover:bg-white/[0.02]"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={seoPage.companionAvatarUrl ?? undefined} />
                          <AvatarFallback className="bg-campfire-500/20 text-campfire-400 text-xs">
                            {seoPage.companionName?.charAt(0) ?? '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-white">{seoPage.companionName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-sm text-gray-400 bg-white/5 px-2 py-1 rounded">
                        /c/{seoPage.slug}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusBadgeClasses(seoPage.status)}>
                        {STATUS_LABELS[seoPage.status]}
                      </Badge>
                      {seoPage.generationError && (
                        <span className="ml-2 text-xs text-red-400" title={seoPage.generationError}>
                          (Error)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-400">
                      v{seoPage.version}
                    </TableCell>
                    <TableCell className="text-gray-400 text-sm">
                      <span title={format(new Date(seoPage.updatedAt), 'PPpp')}>
                        {formatDistanceToNow(new Date(seoPage.updatedAt), { addSuffix: true })}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-400 hover:text-white"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-48 bg-zinc-900 border-white/10"
                        >
                          <DropdownMenuItem
                            onClick={() => router.push(`/admin/seo/${seoPage.id}` as Route)}
                            className="cursor-pointer"
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View / Edit
                          </DropdownMenuItem>
                          {seoPage.status === 'published' && (
                            <DropdownMenuItem
                              onClick={() => window.open(`/c/${seoPage.slug}`, '_blank')}
                              className="cursor-pointer"
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              View Live Page
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator className="bg-white/10" />
                          <DropdownMenuItem
                            onClick={() => handleRegenerate(seoPage.id)}
                            disabled={seoPage.status === 'generating'}
                            className="cursor-pointer"
                          >
                            <Sparkles className="h-4 w-4 mr-2" />
                            Regenerate Content
                          </DropdownMenuItem>
                          {seoPage.status === 'draft' && (
                            <DropdownMenuItem
                              onClick={() => handlePublish(seoPage.id)}
                              className="cursor-pointer text-green-400"
                            >
                              <Globe className="h-4 w-4 mr-2" />
                              Publish
                            </DropdownMenuItem>
                          )}
                          {seoPage.status === 'published' && (
                            <DropdownMenuItem
                              onClick={() => handleUnpublish(seoPage.id)}
                              className="cursor-pointer text-amber-400"
                            >
                              <FileText className="h-4 w-4 mr-2" />
                              Unpublish
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator className="bg-white/10" />
                          <DropdownMenuItem
                            onClick={() => setDeletePageId(seoPage.id)}
                            className="cursor-pointer text-red-400"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {/* Pagination */}
        {!isLoading && pages.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
            <p className="text-sm text-gray-500">
              Page {page}
              {hasMore ? '+' : ''} of {Math.ceil(total / PAGE_SIZE) || 1}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevPage}
                disabled={page === 1}
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

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="bg-zinc-900 border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white">Create SEO Page</DialogTitle>
            <DialogDescription>
              Select a companion to generate an SEO-optimized profile page.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {isLoadingCompanions ? (
              <div className="text-center py-8 text-gray-500">Loading companions...</div>
            ) : availableCompanions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No companions available. All companions already have SEO pages.
              </div>
            ) : (
              <Select value={selectedCompanionId} onValueChange={setSelectedCompanionId}>
                <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder="Select a companion" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10 max-h-64">
                  {availableCompanions.map((companion) => (
                    <SelectItem key={companion.id} value={companion.id}>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={companion.avatarUrl ?? undefined} />
                          <AvatarFallback className="bg-campfire-500/20 text-campfire-400 text-xs">
                            {companion.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        {companion.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              className="border-white/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!selectedCompanionId || isCreating}
              className="bg-campfire-500 hover:bg-campfire-600"
            >
              {isCreating ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Create & Generate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletePageId} onOpenChange={() => setDeletePageId(null)}>
        <AlertDialogContent className="bg-zinc-900 border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete SEO Page?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this SEO page. If published, it will be removed from
              search engine indexes. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
