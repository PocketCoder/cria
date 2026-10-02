import { useSyncExternalStore } from 'react';

/**
 * Open modal `<dialog>`s, oldest first. A modal dialog makes everything
 * outside itself inert and paints it underneath, so overlays that must stay
 * usable while one is open (Radix popovers, the undo toast) have to live
 * *inside* the topmost dialog. Pinned on `globalThis` so Vite HMR can't reset
 * it mid-flight.
 */
interface ModalStack {
  dialogs: HTMLDialogElement[];
  listeners: Set<() => void>;
}
const g = globalThis as typeof globalThis & { __cria_modalStack__?: ModalStack };
const stack: ModalStack = (g.__cria_modalStack__ ??= { dialogs: [], listeners: new Set() });

function emit(): void {
  for (const l of stack.listeners) l();
}

/** Register an opened modal dialog; returns the function that unregisters it. */
export function pushModalDialog(el: HTMLDialogElement): () => void {
  stack.dialogs.push(el);
  emit();
  return () => {
    const i = stack.dialogs.lastIndexOf(el);
    if (i !== -1) stack.dialogs.splice(i, 1);
    emit();
  };
}

function subscribe(listener: () => void): () => void {
  stack.listeners.add(listener);
  return () => stack.listeners.delete(listener);
}

const topModalDialog = (): HTMLDialogElement | null =>
  stack.dialogs[stack.dialogs.length - 1] ?? null;

/** The topmost open modal dialog, or null when the page itself is live. */
export function useTopModalDialog(): HTMLDialogElement | null {
  return useSyncExternalStore(subscribe, topModalDialog, () => null);
}
