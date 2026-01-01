import { create } from 'zustand';
import type { Gift } from '@/lib/api/gifts';

export interface GiftsState {
  // State
  tokenBalance: number;
  availableGifts: Gift[];
  selectedGift: Gift | null;
  isLoadingGifts: boolean;
  isSendingGift: boolean;
  error: string | null;

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
}

export const useGiftsStore = create<GiftsState>()((set) => ({
  // Initial state
  tokenBalance: 0,
  availableGifts: [],
  selectedGift: null,
  isLoadingGifts: false,
  isSendingGift: false,
  error: null,

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
}));
