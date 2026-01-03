import { create } from 'zustand';
import type { Gift, GiftTemplate, GiftTemplateCategory } from '@/lib/api/gifts';

export type TemplateSortBy = 'popular' | 'trending' | 'recent';

export interface GiftsState {
  // State
  tokenBalance: number;
  availableGifts: Gift[];
  selectedGift: Gift | null;
  isLoadingGifts: boolean;
  isSendingGift: boolean;
  error: string | null;

  // Template state
  templates: GiftTemplate[];
  selectedTemplate: GiftTemplate | null;
  isLoadingTemplates: boolean;
  templateCategory: GiftTemplateCategory | null;
  templateSort: TemplateSortBy;
  templatesHasMore: boolean;
  templatesTotal: number;

  // Actions
  setTokenBalance: (balance: number) => void;
  setAvailableGifts: (gifts: Gift[]) => void;
  addGift: (gift: Gift) => void;
  updateGift: (giftId: string, updates: Partial<Gift>) => void;
  selectGift: (gift: Gift | null) => void;
  setIsLoadingGifts: (loading: boolean) => void;
  setIsSendingGift: (sending: boolean) => void;
  setError: (error: string | null) => void;
  clearGifts: () => void;

  // Template actions
  setTemplates: (templates: GiftTemplate[], hasMore: boolean, total: number) => void;
  appendTemplates: (templates: GiftTemplate[], hasMore: boolean, total: number) => void;
  selectTemplate: (template: GiftTemplate | null) => void;
  setIsLoadingTemplates: (loading: boolean) => void;
  setTemplateCategory: (category: GiftTemplateCategory | null) => void;
  setTemplateSort: (sort: TemplateSortBy) => void;
  clearTemplates: () => void;
}

export const useGiftsStore = create<GiftsState>()((set) => ({
  // Initial state
  tokenBalance: 0,
  availableGifts: [],
  selectedGift: null,
  isLoadingGifts: false,
  isSendingGift: false,
  error: null,

  // Template initial state
  templates: [],
  selectedTemplate: null,
  isLoadingTemplates: false,
  templateCategory: null,
  templateSort: 'popular',
  templatesHasMore: false,
  templatesTotal: 0,

  // Actions
  setTokenBalance: (balance) => {
    set({ tokenBalance: balance });
  },

  setAvailableGifts: (gifts) => {
    set({ availableGifts: gifts });
  },

  addGift: (gift) => {
    set((state) => ({
      availableGifts: [...state.availableGifts, gift],
    }));
  },

  updateGift: (giftId, updates) => {
    set((state) => ({
      availableGifts: state.availableGifts.map((g) =>
        g.id === giftId ? { ...g, ...updates } : g
      ),
      selectedGift:
        state.selectedGift?.id === giftId
          ? { ...state.selectedGift, ...updates }
          : state.selectedGift,
    }));
  },

  selectGift: (gift) => {
    set({ selectedGift: gift });
  },

  setIsLoadingGifts: (loading) => {
    set({ isLoadingGifts: loading });
  },

  setIsSendingGift: (sending) => {
    set({ isSendingGift: sending });
  },

  setError: (error) => {
    set({ error });
  },

  clearGifts: () => {
    set({
      availableGifts: [],
      selectedGift: null,
      error: null,
    });
  },

  // Template actions
  setTemplates: (templates, hasMore, total) => {
    set({ templates, templatesHasMore: hasMore, templatesTotal: total });
  },

  appendTemplates: (templates, hasMore, total) => {
    set((state) => ({
      templates: [...state.templates, ...templates],
      templatesHasMore: hasMore,
      templatesTotal: total,
    }));
  },

  selectTemplate: (template) => {
    set({ selectedTemplate: template });
  },

  setIsLoadingTemplates: (loading) => {
    set({ isLoadingTemplates: loading });
  },

  setTemplateCategory: (category) => {
    set({ templateCategory: category, templates: [], selectedTemplate: null });
  },

  setTemplateSort: (sort) => {
    set({ templateSort: sort, templates: [], selectedTemplate: null });
  },

  clearTemplates: () => {
    set({
      templates: [],
      selectedTemplate: null,
      templateCategory: null,
      templateSort: 'popular',
      templatesHasMore: false,
      templatesTotal: 0,
    });
  },
}));
