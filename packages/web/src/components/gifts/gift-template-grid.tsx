'use client';

import { useEffect, useCallback } from 'react';
import { GiftTemplateCard } from './gift-template-card';
import { Button } from '@/components/ui/button';
import { Loader2, Package } from 'lucide-react';
import { useGiftsStore } from '@/stores/gifts-store';
import { getGiftTemplates } from '@/lib/api/gifts';
import type { GiftTemplate } from '@/lib/api/gifts';

interface GiftTemplateGridProps {
  onSelect: (template: GiftTemplate) => void;
  selectedId?: string;
}

export function GiftTemplateGrid({ onSelect, selectedId }: GiftTemplateGridProps) {
  const {
    templates,
    isLoadingTemplates,
    templateCategory,
    templateSort,
    templatesHasMore,
    setTemplates,
    appendTemplates,
    setIsLoadingTemplates,
    setError,
  } = useGiftsStore();

  const loadTemplates = useCallback(async (append = false) => {
    setIsLoadingTemplates(true);
    try {
      const offset = append ? templates.length : 0;
      const result = await getGiftTemplates({
        category: templateCategory ?? undefined,
        sort: templateSort,
        limit: 12,
        offset,
      });

      if (append) {
        appendTemplates(result.templates, result.hasMore, result.total);
      } else {
        setTemplates(result.templates, result.hasMore, result.total);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load gifts');
    } finally {
      setIsLoadingTemplates(false);
    }
  }, [templateCategory, templateSort, templates.length, setTemplates, appendTemplates, setIsLoadingTemplates, setError]);

  // Load templates on mount and when filters change
  useEffect(() => {
    loadTemplates(false);
  }, [templateCategory, templateSort]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoadingTemplates && templates.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Package className="h-12 w-12 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">
          No gifts available yet
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Generate custom gifts to build the library
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {templates.map((template) => (
          <GiftTemplateCard
            key={template.id}
            template={template}
            onSelect={onSelect}
            selected={template.id === selectedId}
          />
        ))}
      </div>

      {templatesHasMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadTemplates(true)}
            disabled={isLoadingTemplates}
          >
            {isLoadingTemplates ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              'Load more'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
