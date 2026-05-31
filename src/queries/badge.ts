import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { startOfDay, isAfter } from 'date-fns';
import { listTasksWithDueDate } from '@/db/tasks';
import { subscribe } from '@/db/bus';

async function setDockBadge(n: number): Promise<void> {
  try {
    // Tauri v2: the badge lives on the window (Dock on macOS, taskbar
    // overlay on Windows). `undefined` clears it. Wrapped in try/catch so
    // the browser-only dev server (no Tauri window) degrades silently.
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setBadgeCount(n > 0 ? n : undefined);
  } catch (err) {
    console.warn('[badge] setBadgeCount failed:', err);
  }
}

/**
 * Drives the macOS Dock badge: count of tasks that are **overdue or due
 * today** (the Today view's load), across all projects. Mount once at the
 * app root. Recomputes on task mutations and on a 60s tick (so a
 * day-rollover or background pull updates the badge without interaction).
 */
export function useDockBadge(): void {
  const qc = useQueryClient();

  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['badge'] });
      }),
    [qc],
  );

  const { data: count = 0 } = useQuery<number>({
    queryKey: ['badge', 'due-count'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const all = await listTasksWithDueDate(); // incomplete, has due_date
      const today = startOfDay(new Date());
      // overdue OR due today === startOfDay(due) is not after today
      return all.filter(
        (t) => t.dueDate && !isAfter(startOfDay(new Date(t.dueDate)), today),
      ).length;
    },
  });

  useEffect(() => {
    void setDockBadge(count);
  }, [count]);
}
