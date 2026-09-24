import { create } from 'zustand';

/**
 * Keyboard row focus for the list view (j/k/Enter shortcuts). Transient —
 * not persisted, cleared when the list navigates elsewhere.
 */
interface ListFocusState {
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
}

export const useListFocus = create<ListFocusState>()((set) => ({
  focusedId: null,
  setFocusedId: (id) => set({ focusedId: id }),
}));
