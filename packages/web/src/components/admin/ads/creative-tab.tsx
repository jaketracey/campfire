'use client';

import { useState, useCallback, useEffect } from 'react';
import { Plus, Video, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CreativeEditor } from './creative-editor';
import {
  listCreatives,
  type AdCreative,
  type AdCreativeStatus,
} from '@/lib/api/creatives';

interface CreativeTabProps {
  refreshKey: number;
}

const statusColors: Record<AdCreativeStatus, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  generating_video: 'bg-blue-500/20 text-blue-400',
  generating_voiceover: 'bg-purple-500/20 text-purple-400',
  ready: 'bg-green-500/20 text-green-400',
  published: 'bg-campfire-500/20 text-campfire-400',
  failed: 'bg-red-500/20 text-red-400',
};

const statusLabels: Record<AdCreativeStatus, string> = {
  draft: 'Draft',
  generating_video: 'Generating Video',
  generating_voiceover: 'Generating Voiceover',
  ready: 'Ready',
  published: 'Published',
  failed: 'Failed',
};

export function CreativeTab({ refreshKey }: CreativeTabProps) {
  const [creatives, setCreatives] = useState<AdCreative[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCreativeId, setSelectedCreativeId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const fetchCreatives = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await listCreatives({ limit: 50 });
      if (res.success && res.data) {
        setCreatives(res.data.creatives);
      }
    } catch (error) {
      console.error('Failed to fetch creatives:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCreatives();
  }, [fetchCreatives, refreshKey]);

  const handleCreateNew = () => {
    setSelectedCreativeId(null);
    setIsCreating(true);
  };

  const handleSelectCreative = (id: string) => {
    setIsCreating(false);
    setSelectedCreativeId(id);
  };

  const handleEditorClose = () => {
    setIsCreating(false);
    setSelectedCreativeId(null);
    fetchCreatives();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-280px)] min-h-[600px]">
      {/* Left panel: Creative list */}
      <div className="w-80 flex-shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">Creatives</h3>
          <Button
            size="sm"
            onClick={handleCreateNew}
            className="gap-2 bg-campfire-500 hover:bg-campfire-600"
          >
            <Plus className="h-4 w-4" />
            New
          </Button>
        </div>

        <div className="flex-1 overflow-auto space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : creatives.length === 0 ? (
            <Card className="bg-white/[0.02] border-white/5">
              <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                <Video className="h-12 w-12 text-gray-600 mb-4" />
                <p className="text-gray-400 text-sm">No creatives yet</p>
                <p className="text-gray-500 text-xs mt-1">
                  Create your first ad creative
                </p>
              </CardContent>
            </Card>
          ) : (
            creatives.map((creative) => (
              <Card
                key={creative.id}
                className={cn(
                  'bg-white/[0.02] border-white/5 cursor-pointer transition-all hover:bg-white/[0.04]',
                  selectedCreativeId === creative.id && 'ring-1 ring-campfire-500/50 bg-campfire-500/5'
                )}
                onClick={() => handleSelectCreative(creative.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {creative.name}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatDate(creative.created_at)}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn('text-[10px] shrink-0', statusColors[creative.status])}
                    >
                      {statusLabels[creative.status]}
                    </Badge>
                  </div>
                  {creative.thumbnail_url && (
                    <div className="mt-2 aspect-video rounded overflow-hidden bg-black/20">
                      <img
                        src={creative.thumbnail_url}
                        alt={creative.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Right panel: Editor */}
      <div className="flex-1 overflow-hidden">
        {isCreating || selectedCreativeId ? (
          <CreativeEditor
            creativeId={selectedCreativeId}
            isNew={isCreating}
            onClose={handleEditorClose}
            onSave={fetchCreatives}
          />
        ) : (
          <Card className="h-full bg-white/[0.02] border-white/5">
            <CardContent className="flex flex-col items-center justify-center h-full text-center">
              <Video className="h-16 w-16 text-gray-600 mb-4" />
              <p className="text-gray-400">Select a creative or create a new one</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCreateNew}
                className="mt-4 gap-2"
              >
                <Plus className="h-4 w-4" />
                New Creative
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
