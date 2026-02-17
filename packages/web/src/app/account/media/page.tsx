'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Image as ImageIcon,
  Video,
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
  Download,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRequireAuth } from '@/hooks/use-auth';
import { getUserMedia, type UserMediaItem, type MediaStatus } from '@/lib/api/media';

type MediaFilter = 'all' | 'images' | 'videos';
type StatusFilter = 'all' | 'ready' | 'generating' | 'failed';

const STATUS_ICONS: Record<MediaStatus, React.ElementType> = {
  pending: Clock,
  generating: RefreshCw,
  encoding: RefreshCw,
  ready: CheckCircle,
  failed: XCircle,
};

const STATUS_COLORS: Record<MediaStatus, string> = {
  pending: 'text-amber-400',
  generating: 'text-blue-400 animate-spin',
  encoding: 'text-blue-400 animate-spin',
  ready: 'text-green-400',
  failed: 'text-red-400',
};

export default function MediaGalleryPage() {
  const { isAuthenticated, isLoading: authLoading } = useRequireAuth('/login');
  const [media, setMedia] = useState<UserMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedItem, setSelectedItem] = useState<UserMediaItem | null>(null);

  useEffect(() => {
    if (!isAuthenticated || authLoading) return;

    async function loadMedia() {
      try {
        const response = await getUserMedia({ limit: 100 });
        setMedia(response.data);
      } catch (err) {
        console.error('Failed to load media:', err);
      } finally {
        setLoading(false);
      }
    }

    loadMedia();

    // Poll for status updates every 10 seconds
    const interval = setInterval(loadMedia, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated, authLoading]);

  if (authLoading || !isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const filteredMedia = media.filter((item) => {
    if (mediaFilter === 'images' && item.type !== 'image') return false;
    if (mediaFilter === 'videos' && item.type !== 'video') return false;
    if (statusFilter === 'ready' && item.status !== 'ready') return false;
    if (statusFilter === 'generating' && !['pending', 'generating', 'encoding'].includes(item.status)) return false;
    if (statusFilter === 'failed' && item.status !== 'failed') return false;
    return true;
  });

  const images = media.filter((m) => m.type === 'image');
  const videos = media.filter((m) => m.type === 'video');
  const generating = media.filter((m) => ['pending', 'generating', 'encoding'].includes(m.status));

  return (
    <div className="min-h-screen bg-background">
      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Page Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white">Media Gallery</h1>
              <p className="text-gray-400 mt-1">
                Your generated images and videos
              </p>
            </div>

            {/* Stats */}
            <div className="flex gap-3">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5">
                <ImageIcon className="h-4 w-4 text-blue-400" />
                <span className="text-white font-medium">{images.length}</span>
                <span className="text-gray-400 text-sm">images</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5">
                <Video className="h-4 w-4 text-red-400" />
                <span className="text-white font-medium">{videos.length}</span>
                <span className="text-gray-400 text-sm">videos</span>
              </div>
              {generating.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <RefreshCw className="h-4 w-4 text-amber-400 animate-spin" />
                  <span className="text-amber-400 font-medium">{generating.length}</span>
                  <span className="text-amber-400 text-sm">generating</span>
                </div>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-4">
            <Tabs value={mediaFilter} onValueChange={(v) => setMediaFilter(v as MediaFilter)}>
              <TabsList className="bg-white/5">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="images">Images</TabsTrigger>
                <TabsTrigger value="videos">Videos</TabsTrigger>
              </TabsList>
            </Tabs>

            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <TabsList className="bg-white/5">
                <TabsTrigger value="all">All Status</TabsTrigger>
                <TabsTrigger value="ready">Ready</TabsTrigger>
                <TabsTrigger value="generating">Generating</TabsTrigger>
                <TabsTrigger value="failed">Failed</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Media Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            </div>
          ) : filteredMedia.length === 0 ? (
            <Card className="bg-white/[0.02] border-white/10">
              <CardContent className="py-20 text-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center">
                    {mediaFilter === 'videos' ? (
                      <Video className="h-8 w-8 text-gray-500" />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-gray-500" />
                    )}
                  </div>
                  <p className="text-gray-400">No media found</p>
                  <p className="text-sm text-gray-500">
                    Start a conversation and generate some images or request videos!
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredMedia.map((item) => (
                <MediaCard key={item.id} item={item} onSelect={setSelectedItem} />
              ))}
            </div>
          )}
        </motion.div>
      </main>

      {/* Lightbox Dialog */}
      <Dialog open={selectedItem !== null} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-4xl bg-black/95 border-white/10 p-0">
          <DialogTitle className="sr-only">
            {selectedItem ? `${selectedItem.type === 'video' ? 'Video' : 'Image'} by ${selectedItem.companionName}` : 'Media preview'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {selectedItem ? `${selectedItem.type === 'video' ? 'Video' : 'Image'} created on ${new Date(selectedItem.createdAt).toLocaleDateString()}` : ''}
          </DialogDescription>
          {selectedItem?.status === 'ready' && selectedItem.url && (
            <div className="relative">
              {selectedItem.type === 'video' ? (
                <video
                  src={selectedItem.url}
                  poster={selectedItem.thumbnailUrl || undefined}
                  className="w-full max-h-[80vh] object-contain"
                  controls
                  autoPlay
                />
              ) : (
                <img
                  src={selectedItem.thumbnailUrl || selectedItem.url}
                  alt={`Generated image by ${selectedItem.companionName}`}
                  className="w-full max-h-[80vh] object-contain"
                />
              )}
              <div className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm text-gray-300">{selectedItem.companionName}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(selectedItem.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <a
                  href={selectedItem.url}
                  download
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-white transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Download
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MediaCard({ item, onSelect }: { item: UserMediaItem; onSelect: (item: UserMediaItem) => void }) {
  const StatusIcon = STATUS_ICONS[item.status] || Clock;
  const statusColor = STATUS_COLORS[item.status] || 'text-gray-400';
  const isVideo = item.type === 'video';
  const isReady = item.status === 'ready' && item.url;

  const handleActivate = useCallback(() => {
    if (isReady) {
      onSelect(item);
    }
  }, [isReady, item, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleActivate();
      }
    },
    [handleActivate]
  );

  const label = isReady
    ? `View ${isVideo ? 'video' : 'image'} by ${item.companionName}, ${new Date(item.createdAt).toLocaleDateString()}`
    : `${item.type === 'video' ? 'Video' : 'Image'} by ${item.companionName}, status: ${item.status}`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      tabIndex={0}
      role={isReady ? 'button' : 'group'}
      aria-label={label}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      className={`group relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black transition-all ${isReady ? 'cursor-pointer' : ''}`}
    >
      {/* Thumbnail/Video */}
      {isReady ? (
        isVideo ? (
          <video
            src={item.url!}
            poster={item.thumbnailUrl || undefined}
            className="w-full h-full object-cover"
            controls
            preload="metadata"
            tabIndex={-1}
          />
        ) : (
          <img
            src={item.thumbnailUrl || item.url!}
            alt={`Generated image by ${item.companionName}`}
            className="w-full h-full object-cover"
          />
        )
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3">
          <StatusIcon className={`h-10 w-10 ${statusColor}`} />
          <span className="text-sm text-gray-400 capitalize">{item.status}</span>
        </div>
      )}

      {/* Type Badge */}
      <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm">
        {isVideo ? (
          <Video className="h-4 w-4 text-red-400" />
        ) : (
          <ImageIcon className="h-4 w-4 text-blue-400" />
        )}
      </div>

      {/* Status Badge (if not ready) */}
      {item.status !== 'ready' && (
        <div className="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm">
          <StatusIcon className={`h-4 w-4 ${statusColor}`} />
        </div>
      )}

      {/* Info Overlay */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
        <p className="text-xs text-gray-300 truncate">{item.companionName}</p>
        <p className="text-xs text-gray-500">
          {new Date(item.createdAt).toLocaleDateString()}
        </p>
      </div>
    </motion.div>
  );
}
