import { create } from 'zustand';

export interface SyncError {
  step: string;
  message: string;
  timestamp: number;
}

interface SyncProgressState {
  currentStep: string | null;
  isSyncing: boolean;
  errors: SyncError[];
  setStep: (step: string | null) => void;
  addError: (step: string, message: string) => void;
  clearErrors: () => void;
}

export const useSyncProgress = create<SyncProgressState>((set) => ({
  currentStep: null,
  isSyncing: false,
  errors: [],
  setStep: (step) => set({ currentStep: step, isSyncing: step !== null }),
  addError: (step, message) =>
    set((s) => ({
      errors: [...s.errors.slice(-19), { step, message, timestamp: Date.now() }],
    })),
  clearErrors: () => set({ errors: [] }),
}));
