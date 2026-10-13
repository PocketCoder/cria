import { create } from 'zustand';

export type ToastKind = 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

// Errors stay longer: there is more to read and something to act on.
const LIFETIME_MS: Record<ToastKind, number> = { success: 2000, error: 5000 };

let nextId = 1;

/** Brief, non-blocking messages ("Saved"). They float over the page, so showing one never moves the layout. */
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, kind = 'success') => {
    const id = nextId++;
    // A repeat of the same message replaces the old one instead of stacking.
    set((s) => ({ toasts: [...s.toasts.filter((t) => t.message !== message || t.kind !== kind), { id, message, kind }] }));
    setTimeout(() => get().dismiss(id), LIFETIME_MS[kind]);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const showToast = (message: string, kind?: ToastKind) => useToasts.getState().show(message, kind);
