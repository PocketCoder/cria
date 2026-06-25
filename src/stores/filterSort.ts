import { create } from 'zustand';
import type { SortRule } from '@/lib/sortEngine';

interface FilterSortState {
  filterQuery: string;
  sortRule: SortRule | null;
  showFilterBar: boolean;
  showSortMenu: boolean;
  setFilterQuery: (q: string) => void;
  setSortRule: (r: SortRule | null) => void;
  setShowFilterBar: (v: boolean) => void;
  setShowSortMenu: (v: boolean) => void;
  resetFilterSort: () => void;
}

export const useFilterSort = create<FilterSortState>()((set) => ({
  filterQuery: '',
  sortRule: null,
  showFilterBar: false,
  showSortMenu: false,
  setFilterQuery: (q) => set({ filterQuery: q }),
  setSortRule: (r) => set({ sortRule: r, showSortMenu: false }),
  setShowFilterBar: (v) => set({ showFilterBar: v }),
  setShowSortMenu: (v) => set({ showSortMenu: v }),
  resetFilterSort: () => set({ filterQuery: '', sortRule: null, showFilterBar: false, showSortMenu: false }),
}));
