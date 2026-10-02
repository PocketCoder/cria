import { useEffect } from 'react';
import { useUi } from '@/stores/ui';
import { useListFocus } from '@/stores/listFocus';
import { onShortcut } from '@/lib/shortcutBus';
import { flattenTreeIds, type TaskTreeNode } from './taskTree';

/**
 * j/k/Enter row focus (fixed shortcut set). Moves through the visible tree in
 * display order; Enter opens the focused task's detail card.
 */
export function useRowKeyboardNav(taskTree: TaskTreeNode[]): void {
  useEffect(() => {
    const move = (delta: 1 | -1) => {
      const ids = flattenTreeIds(taskTree);
      if (ids.length === 0) return;
      const { focusedId, setFocusedId } = useListFocus.getState();
      const idx = focusedId ? ids.indexOf(focusedId) : -1;
      const next = ids[Math.min(ids.length - 1, Math.max(0, idx + delta))]!;
      setFocusedId(next);
      document
        .querySelector(`[data-task-row="${next}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    };
    const subs = [
      onShortcut('list.down', () => move(1)),
      onShortcut('list.up', () => move(-1)),
      onShortcut('list.open', () => {
        const { focusedId } = useListFocus.getState();
        if (focusedId) useUi.getState().setSelectedTask(focusedId);
      }),
    ];
    return () => {
      subs.forEach((u) => u());
      useListFocus.getState().setFocusedId(null);
    };
  }, [taskTree]);
}
