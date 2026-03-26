'use client';

import { useState, useMemo, useCallback } from 'react';
import type { CompanionCategory, FeaturedCompanion } from '@/data/featured-companions';

interface UseCompanionFilterOptions {
  companions: FeaturedCompanion[];
}

interface UseCompanionFilterReturn {
  /** The currently active category filter */
  activeCategory: CompanionCategory;
  /** Set the active category filter */
  setActiveCategory: (category: CompanionCategory) => void;
  /** The current search query */
  searchQuery: string;
  /** Set the search query */
  setSearchQuery: (query: string) => void;
  /** Filtered companions based on active category and search query */
  filteredCompanions: FeaturedCompanion[];
}

/**
 * Hook for filtering featured companions by category and search query.
 * Supports filtering by category (caring, playful, intellectual, etc.)
 * and text search by companion name.
 */
export function useCompanionFilter({
  companions,
}: UseCompanionFilterOptions): UseCompanionFilterReturn {
  const [activeCategory, setActiveCategory] = useState<CompanionCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const handleSetCategory = useCallback((category: CompanionCategory) => {
    setActiveCategory(category);
  }, []);

  const handleSetSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const filteredCompanions = useMemo(() => {
    let result = companions;

    // Filter by category
    if (activeCategory !== 'all') {
      result = result.filter((c) => c.category === activeCategory);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.tagline.toLowerCase().includes(query) ||
          c.traits.some((t) => t.toLowerCase().includes(query))
      );
    }

    return result;
  }, [companions, activeCategory, searchQuery]);

  return {
    activeCategory,
    setActiveCategory: handleSetCategory,
    searchQuery,
    setSearchQuery: handleSetSearch,
    filteredCompanions,
  };
}
