'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { ChevronLeft, ChevronRight, X, ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { getAdminCompanionImages, type AdminCompanionImage } from '@/lib/api/admin-companions';

interface CompanionImageGalleryProps {
  companionId: string;
}

const PAGE_SIZE = 12;

export function CompanionImageGallery({ companionId }: CompanionImageGalleryProps) {
  const [images, setImages] = useState<AdminCompanionImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedImage, setSelectedImage] = useState<AdminCompanionImage | null>(null);

  const fetchImages = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await getAdminCompanionImages(companionId, {
        limit: PAGE_SIZE,
        offset,
      });
      setImages(response.data.images);
      setHasMore(response.data.hasMore);
    } catch (error) {
      console.error('Failed to fetch images:', error);
    } finally {
      setIsLoading(false);
    }
  }, [companionId, offset]);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - PAGE_SIZE));
  };

  const handleNextPage = () => {
    if (hasMore) {
      setOffset(offset + PAGE_SIZE);
    }
  };

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  if (isLoading && images.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
      </div>
    );
  }

  if (!isLoading && images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <ImageIcon className="h-12 w-12 mb-3 opacity-50" />
        <p>No images generated yet</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Image Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {images.map((image) => (
            <button
              key={image.id}
              onClick={() => setSelectedImage(image)}
              className="group relative aspect-[3/4] rounded-lg overflow-hidden bg-white/5 hover:ring-2 hover:ring-campfire-500/50 transition-all"
            >
              <Image
                src={image.url}
                alt={image.emotionalState}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute bottom-2 left-2 right-2">
                  <Badge variant="outline" className="bg-black/50 border-white/20 text-white text-xs">
                    {image.emotionalState}
                  </Badge>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Pagination */}
        {(offset > 0 || hasMore) && (
          <div className="flex items-center justify-between pt-4 border-t border-white/5">
            <p className="text-sm text-gray-500">
              Page {currentPage}
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

      {/* Image Detail Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-3xl bg-zinc-900 border-white/10">
          <DialogTitle className="sr-only">Image Details</DialogTitle>
          {selectedImage && (
            <div className="space-y-4">
              <div className="relative aspect-[3/4] max-h-[60vh] rounded-lg overflow-hidden bg-white/5">
                <Image
                  src={selectedImage.url}
                  alt={selectedImage.emotionalState}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 768px"
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="bg-campfire-500/10 text-campfire-400 border-campfire-500/20">
                    {selectedImage.emotionalState}
                  </Badge>
                  <Badge variant="outline" className="bg-white/5 text-gray-400 border-white/10">
                    {selectedImage.style}
                  </Badge>
                  <Badge variant="outline" className="bg-white/5 text-gray-400 border-white/10">
                    {selectedImage.width}x{selectedImage.height}
                  </Badge>
                  <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20">
                    {selectedImage.provider}
                  </Badge>
                </div>
                {selectedImage.prompt && (
                  <p className="text-sm text-gray-400 line-clamp-3">
                    {selectedImage.prompt}
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  Generated {formatDistanceToNow(new Date(selectedImage.createdAt), { addSuffix: true })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedImage(null)}
                className="absolute top-2 right-2 text-gray-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
