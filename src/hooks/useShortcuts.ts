import { useEffect, useRef } from 'react';
import { useUi } from '@/stores/ui';
import { createKeyMatcher, eventToKey } from '@/lib/keySequence';
import { SHORTCUTS, MATCHABLE_SHORTCUTS } from '@/lib/shortcuts';
import { emitShortcut } from '@/lib/shortcutBus';
import type { ViewKind } from '@/domain/view';

const SEQUENCE_TIMEOUT_MS = 1000;

interface ShortcutHandlers {
  switchView: (kind: ViewKind) => void;
  openQuickSearch: () => void;
  openLabelManager: () => void;
}

/**
 * Mounts the single keydown listener for the fixed Vikunja shortcut set
 * (B-series). Navigation/view actions run here; `task.*` and `list.*`
 * actions go over the shortcut bus to whichever component owns the handler
 * (task detail card, task list). Context gates run at dispatch time.
 */
export function useShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Read fresh UI state at dispatch time without re-mounting the listener.
  const uiRef = useRef(useUi.getState());
  useEffect(() => useUi.subscribe((s) => { uiRef.current = s; }), []);

  useEffect(() => {
    const matcher = createKeyMatcher(MATCHABLE_SHORTCUTS, SEQUENCE_TIMEOUT_MS);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const dispatch = (id: string) => {
      const def = SHORTCUTS.find((s) => s.id === id);
      if (!def) return;
      const ui = uiRef.current;
      const h = handlersRef.current;

      if (def.context === 'taskDetail' && !ui.selectedTaskLocalId) return;
      if (
        (def.context === 'project' || def.context === 'list') &&
        ui.activeView?.kind !== 'project'
      ) {
        return;
      }

      switch (id) {
        case 'general.toggleMenu':
          ui.toggleSidebar();
          return;
        case 'general.quickSearch':
          h.openQuickSearch();
          return;
        case 'nav.today':
          ui.setActiveView({ kind: 'today' });
          return;
        case 'nav.upcoming':
          ui.setActiveView({ kind: 'upcoming' });
          return;
        case 'nav.labels':
          h.openLabelManager();
          return;
        case 'view.list':
        case 'view.gantt':
        case 'view.table':
        case 'view.kanban':
          h.switchView(id.slice('view.'.length) as ViewKind);
          return;
        default:
          // task.* / list.* — owned by whichever component is mounted.
          emitShortcut(id);
      }
    };

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
        )
      ) {
        return;
      }
      const key = eventToKey(e);
      if (!key) return;

      const res = matcher.feed(key, e.timeStamp);
      res.fired.forEach(dispatch);
      if (res.fired.length > 0 || res.pending) e.preventDefault();

      clearTimeout(timer);
      if (res.pending) {
        // Resolve a deferred prefix match ('.' waiting on '..') on its own.
        const at = e.timeStamp;
        timer = setTimeout(() => {
          const late = matcher.tick(at + SEQUENCE_TIMEOUT_MS + 1);
          if (late) dispatch(late);
        }, SEQUENCE_TIMEOUT_MS + 50);
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handler);
    };
  }, []);
}
