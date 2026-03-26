import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCompanionFilter } from '@/hooks/use-companion-filter';
import { FEATURED_COMPANIONS } from '@/data/featured-companions';

describe('useCompanionFilter', () => {
  it('returns all companions when category is "all" and no search query', () => {
    const { result } = renderHook(() =>
      useCompanionFilter({ companions: FEATURED_COMPANIONS })
    );

    expect(result.current.activeCategory).toBe('all');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.filteredCompanions.length).toBe(
      FEATURED_COMPANIONS.length
    );
  });

  it('filters by category', () => {
    const { result } = renderHook(() =>
      useCompanionFilter({ companions: FEATURED_COMPANIONS })
    );

    act(() => {
      result.current.setActiveCategory('caring');
    });

    expect(result.current.activeCategory).toBe('caring');
    expect(
      result.current.filteredCompanions.every((c) => c.category === 'caring')
    ).toBe(true);
    expect(result.current.filteredCompanions.length).toBeGreaterThan(0);
  });

  it('filters by search query (name)', () => {
    const { result } = renderHook(() =>
      useCompanionFilter({ companions: FEATURED_COMPANIONS })
    );

    act(() => {
      result.current.setSearchQuery('Luna');
    });

    expect(result.current.filteredCompanions.length).toBe(1);
    expect(result.current.filteredCompanions[0].name).toBe('Luna');
  });

  it('filters by search query (trait)', () => {
    const { result } = renderHook(() =>
      useCompanionFilter({ companions: FEATURED_COMPANIONS })
    );

    act(() => {
      result.current.setSearchQuery('Empathetic');
    });

    expect(result.current.filteredCompanions.length).toBeGreaterThan(0);
    expect(
      result.current.filteredCompanions.some((c) =>
        c.traits.includes('Empathetic')
      )
    ).toBe(true);
  });

  it('combines category and search filters', () => {
    const { result } = renderHook(() =>
      useCompanionFilter({ companions: FEATURED_COMPANIONS })
    );

    act(() => {
      result.current.setActiveCategory('bold');
      result.current.setSearchQuery('Ember');
    });

    expect(result.current.filteredCompanions.length).toBe(1);
    expect(result.current.filteredCompanions[0].name).toBe('Ember');
  });

  it('returns empty array when nothing matches', () => {
    const { result } = renderHook(() =>
      useCompanionFilter({ companions: FEATURED_COMPANIONS })
    );

    act(() => {
      result.current.setSearchQuery('zzzznonexistent');
    });

    expect(result.current.filteredCompanions.length).toBe(0);
  });

  it('search is case-insensitive', () => {
    const { result } = renderHook(() =>
      useCompanionFilter({ companions: FEATURED_COMPANIONS })
    );

    act(() => {
      result.current.setSearchQuery('luna');
    });

    expect(result.current.filteredCompanions.length).toBe(1);
    expect(result.current.filteredCompanions[0].name).toBe('Luna');
  });
});
