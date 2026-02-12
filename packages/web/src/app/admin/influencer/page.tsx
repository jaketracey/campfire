'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  RefreshCw,
  Plus,
  Sparkles,
  CheckCircle2,
  Clock,
  AlertCircle,
  Trash2,
  Download,
  Loader2,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  listInfluencerModels,
  getInfluencerModelStats,
  deleteInfluencerModel,
  getLoraDownloadUrl,
  type InfluencerModel,
  type InfluencerModelStats,
} from '@/lib/api/influencer-models';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  pending: {
    label: 'Pending',
    color: 'bg-gray-500/20 text-gray-400',
    icon: Clock,
  },
  uploading: {
    label: 'Uploading',
    color: 'bg-blue-500/20 text-blue-400',
    icon: Loader2,
  },
  training: {
    label: 'Training',
    color: 'bg-yellow-500/20 text-yellow-400',
    icon: Sparkles,
  },
  downloading: {
    label: 'Downloading',
    color: 'bg-purple-500/20 text-purple-400',
    icon: Download,
  },
  ready: {
    label: 'Ready',
    color: 'bg-green-500/20 text-green-400',
    icon: CheckCircle2,
  },
  failed: {
    label: 'Failed',
    color: 'bg-red-500/20 text-red-400',
    icon: AlertCircle,
  },
};

const PAGE_SIZE = 20;

export default function AdminInfluencerPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [models, setModels] = useState<InfluencerModel[]>([]);
  const [stats, setStats] = useState<InfluencerModelStats | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Ignore stale responses from older in-flight list requests.
  const latestModelsRequestRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  const fetchStats = useCallback(async () => {
    const statsRes = await getInfluencerModelStats();
    setStats(statsRes);
  }, []);

  const fetchModels = useCallback(async () => {
    const requestId = ++latestModelsRequestRef.current;
    try {
      setIsLoading(true);
      setError(null);
      const modelsRes = await listInfluencerModels({
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      if (requestId !== latestModelsRequestRef.current) {
        return;
      }
      setModels(modelsRes.models);
      setHasMore(modelsRes.hasMore);
    } catch (err) {
      if (requestId !== latestModelsRequestRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load model list');
    } finally {
      if (requestId === latestModelsRequestRef.current) {
        setIsLoading(false);
      }
    }
  }, [debouncedSearch, offset]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    fetchStats().catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    });
  }, [fetchStats]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([fetchModels(), fetchStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh data');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const targetId = deleteId;
    setIsDeleting(true);
    try {
      await deleteInfluencerModel(targetId);
      setDeleteId(null);
      await Promise.all([fetchModels(), fetchStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete model');
    } finally {
      setIsDeleting(false);
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

  const handleDownloadLora = async (modelId: string) => {
    try {
      const url = await getLoraDownloadUrl(modelId);
      if (url) {
        window.open(url, '_blank');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get download URL');
    }
  };

  const StatusBadge = ({ status }: { status: InfluencerModel['status'] }) => {
    const config = STATUS_CONFIG[status];
    const Icon = config.icon;
    return (
      <Badge className={cn('flex items-center gap-1', config.color)}>
        <Icon className={cn('h-3 w-3', status === 'training' && 'animate-pulse')} />
        {config.label}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Influencer Models</h1>
          <p className="text-gray-400 text-sm">Train custom LoRA models for influencer personas</p>
        </div>
        <Link href={'/admin/influencer/create' as Route}>
          <Button className="bg-campfire-500 hover:bg-campfire-600">
            <Plus className="h-4 w-4 mr-2" />
            Train New Model
          </Button>
        </Link>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <Card className="bg-white/[0.02] border-white/5">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-white">{stats.total}</div>
              <div className="text-sm text-gray-400">Total Models</div>
            </CardContent>
          </Card>
          <Card className="bg-white/[0.02] border-white/5">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-400">{stats.ready}</div>
              <div className="text-sm text-gray-400">Ready</div>
            </CardContent>
          </Card>
          <Card className="bg-white/[0.02] border-white/5">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-yellow-400">{stats.training}</div>
              <div className="text-sm text-gray-400">Training</div>
            </CardContent>
          </Card>
          <Card className="bg-white/[0.02] border-white/5">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-400">{stats.failed}</div>
              <div className="text-sm text-gray-400">Failed</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Model List */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-campfire-500" />
            Models
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or trigger word..."
              className="w-64 bg-white/5 border-white/10"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="border-white/10"
            >
              <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="text-gray-400 text-sm">Loading models...</div>
          ) : models.length === 0 ? (
            <div className="text-gray-400 text-sm">
              No models found.{' '}
              <Link
                href={'/admin/influencer/create' as Route}
                className="text-campfire-500 hover:underline"
              >
                Create your first model
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {models.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/influencer/${model.id}` as Route}
                        className="font-medium text-white truncate hover:text-campfire-400 transition-colors"
                      >
                        {model.name}
                      </Link>
                      <StatusBadge status={model.status} />
                      {model.isStyle && (
                        <Badge className="bg-purple-500/20 text-purple-400">Style</Badge>
                      )}
                    </div>
                    <div className="text-sm text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <span>
                        Trigger: <span className="font-mono text-xs text-white">{model.triggerWord}</span>
                      </span>
                      <span>
                        Images: <span className="text-white">{model.imageCount}</span>
                      </span>
                      <span>
                        Steps: <span className="text-white">{model.trainingSteps}</span>
                      </span>
                      {model.statusMessage && (
                        <span className="text-red-400">{model.statusMessage}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {model.status === 'ready' && (
                      <Link href={`/admin/influencer/${model.id}` as Route}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-campfire-500/30 text-campfire-400 hover:bg-campfire-500/10"
                        >
                          <ImageIcon className="h-4 w-4 mr-1" />
                          Samples
                        </Button>
                      </Link>
                    )}
                    {model.status === 'ready' && model.hasLora && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownloadLora(model.id)}
                        className="border-white/10"
                      >
                        <Download className="h-4 w-4 mr-1" />
                        LoRA
                      </Button>
                    )}
                    {model.status === 'pending' || model.status === 'uploading' ? (
                      <Link href={`/admin/influencer/create?id=${model.id}` as Route}>
                        <Button variant="outline" size="sm" className="border-white/10">
                          Continue Setup
                        </Button>
                      </Link>
                    ) : null}
                    <AlertDialog open={deleteId === model.id} onOpenChange={(open) => !open && setDeleteId(null)}>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteId(model.id)}
                          className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-zinc-900 border-white/10">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-white">Delete Model</AlertDialogTitle>
                          <AlertDialogDescription className="text-gray-400">
                            Are you sure you want to delete &quot;{model.name}&quot;? This will permanently
                            remove all training images and the LoRA weights. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-white/10">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="bg-red-600 hover:bg-red-700"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-2" />
                            )}
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!isLoading && models.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-sm text-gray-500">
            Page {currentPage}
            {hasMore ? '+' : ''} &middot; Showing {models.length} models
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
    </div>
  );
}
