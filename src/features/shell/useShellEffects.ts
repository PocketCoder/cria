import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { listen } from '@tauri-apps/api/event';
import { register, unregister } from '@/tauri/globalShortcut';
import { useSettings } from '@/stores/settings';
import { isMobilePlatform } from '@/lib/platform';
import { pushTraySettings } from '@/lib/traySettings';
import { nativeNotify } from '@/utils/notify';
import { useUi, type ActiveView } from '@/stores/ui';
import { getDb } from '@/db';
import { parseDeepLink, resolveInitialViewId } from './shellLogic';

type SetFlag = Dispatch<SetStateAction<boolean>>;

/**
 * Resolve the initial view when opening a project without a viewLocalId.
 * Must preserve selectedTaskLocalId — the palette may have set both
 * activeView and selectedTaskLocalId atomically, and calling setActiveView
 * here would clear the selection and close the detail card.
 */
export function useInitialProjectView(
  activeView: ActiveView | null,
  projectViews: { localId: string }[],
): void {
  useEffect(() => {
    const av = activeView;
    if (av?.kind === 'project' && !av.viewLocalId && projectViews.length > 0) {
      const stored = localStorage.getItem(`cria:projectView:${av.localId}`);
      const targetId = resolveInitialViewId(stored, projectViews);
      const selected = useUi.getState().selectedTaskLocalId;
      useUi.setState({
        activeView: { kind: 'project', localId: av.localId, viewLocalId: targetId },
        selectedTaskLocalId: selected,
      });
    }
  }, [activeView, projectViews]); // guarded: re-runs are no-ops once viewLocalId is set
}

/** Notify only on sync conflicts (not routine outbox drain). */
export function useConflictNotification(conflictCount: number): void {
  const prevConflicts = useRef<number>(conflictCount);

  useEffect(() => {
    if (prevConflicts.current === 0 && conflictCount > 0) {
      nativeNotify('Conflicts detected', `${conflictCount} conflict(s) need your attention`);
    }
    prevConflicts.current = conflictCount;
  }, [conflictCount]);
}

/** Tray icon quick-add. */
export function useTrayQuickAdd(setShowQuickAdd: SetFlag): void {
  useEffect(() => {
    const unlisten = listen('tray-quick-add', () => {
      setShowQuickAdd(true);
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [setShowQuickAdd]);
}

/**
 * Push the persisted tray settings to Rust on startup. Rust boots with its own
 * defaults (close to tray on, dock icon shown), so without this a saved "off"
 * is ignored until the toggle is touched again. The persist store hydrates
 * synchronously from localStorage, so it is already populated here. Close to
 * tray and hide-dock are sent as false while the tray icon is off.
 */
export function useTraySettingsSync(): void {
  useEffect(() => {
    if (isMobilePlatform()) return; // tray commands are desktop-only Rust-side
    pushTraySettings(useSettings.getState());
  }, []);
}

/** Deep‑link handling (vikunja://task/<id> or project). */
export function useDeepLinks(
  setSelectedProject: (id: string | null) => void,
  setSelectedTask: (id: string | null) => void,
): void {
  useEffect(() => {
    const unlisten = listen<string>('tauri://url', async (event) => {
      const url = event.payload;
      try {
        const link = parseDeepLink(url);
        if (!link) return;
        const { type, serverId } = link;
        const db = await getDb();
        const row = await db.select<{ local_id: string }[]>(
          `SELECT local_id FROM ${type}s WHERE server_id = ? LIMIT 1`,
          [serverId]
        );
        const localId = row[0]?.local_id;
        if (localId) {
          if (type === 'project') {
            setSelectedProject(localId);
          } else {
            setSelectedTask(localId);
          }
        }
      } catch (e) {
        console.error('Deep link handling error', e);
      }
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [setSelectedProject, setSelectedTask]);
}

/** Register global shortcut Cmd+Shift+A for Quick Add. */
export function useGlobalQuickAddShortcut(setShowQuickAdd: SetFlag): void {
  useEffect(() => {
    const shortcut = 'CommandOrControl+Shift+A';
    register(shortcut, () => setShowQuickAdd(true)).catch((e) => console.error('Failed to register shortcut', e));
    return () => {
      unregister(shortcut).catch((e) => console.error('Failed to unregister shortcut', e));
    };
  }, [setShowQuickAdd]);
}

/**
 * Dev‑only keyboard shortcut (⌘+Shift+A) — Tauri global shortcut covers
 * production; this handler is just so the dev webview gets it too.
 */
export function useDevShortcuts(setShowQuickAdd: SetFlag, setShowCommandPalette: SetFlag): void {
  useEffect(() => {
    if (import.meta.env.MODE !== 'development') return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'A') {
        setShowQuickAdd(true);
      }
      // Cmd/Ctrl+F → open the command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowCommandPalette(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setShowQuickAdd, setShowCommandPalette]);
}
