import type { KeyBinding } from './keySequence';

/**
 * The fixed shortcut set, mirroring upstream Vikunja's
 * keyboard-shortcuts/shortcuts.ts (fixed constants, not rebindable).
 *
 * Deliberate gaps vs upstream, where Cria has no equivalent target:
 * - g p "projects" (no all-projects page; the sidebar is always visible)
 * - ⌘S save (Cria autosaves)
 * - f/r/⇧R/e on task detail (attachments, related, reminders and the
 *   description are always-visible sections in Cria, not popovers)
 * Kanban's ⌘click toggle-done is a mouse binding implemented in
 * KanbanBoard, listed here for the Shortcuts settings display only.
 */

export type ShortcutContext = 'global' | 'project' | 'list' | 'taskDetail';

export interface ShortcutDef extends KeyBinding {
  /** Where the binding is live. Checked at dispatch time. */
  context: ShortcutContext;
  /** Human-readable group + label for the Shortcuts settings tab. */
  group: string;
  label: string;
  /** Display-only rows (mouse bindings) are never fed to the matcher. */
  displayOnly?: boolean;
}

export const SHORTCUTS: ShortcutDef[] = [
  // ── General ──
  { id: 'general.toggleMenu', keys: ['mod+e'], context: 'global', group: 'General', label: 'Toggle sidebar' },
  { id: 'general.quickSearch', keys: ['mod+k'], context: 'global', group: 'General', label: 'Quick search' },

  // ── Navigation (g then …) ──
  { id: 'nav.today', keys: ['g', 'o'], context: 'global', group: 'Navigation', label: 'Go to Today' },
  { id: 'nav.upcoming', keys: ['g', 'u'], context: 'global', group: 'Navigation', label: 'Go to Upcoming' },
  { id: 'nav.labels', keys: ['g', 'a'], context: 'global', group: 'Navigation', label: 'Manage labels' },
  { id: 'nav.teams', keys: ['g', 'm'], context: 'global', group: 'Navigation', label: 'Manage teams' },

  // ── Project views (g then …) ──
  { id: 'view.list', keys: ['g', 'l'], context: 'project', group: 'Project views', label: 'Switch to List' },
  { id: 'view.gantt', keys: ['g', 'g'], context: 'project', group: 'Project views', label: 'Switch to Gantt' },
  { id: 'view.table', keys: ['g', 't'], context: 'project', group: 'Project views', label: 'Switch to Table' },
  { id: 'view.kanban', keys: ['g', 'k'], context: 'project', group: 'Project views', label: 'Switch to Kanban' },

  // ── Task list ──
  { id: 'list.down', keys: ['j'], context: 'list', group: 'Task list', label: 'Focus next task' },
  { id: 'list.up', keys: ['k'], context: 'list', group: 'Task list', label: 'Focus previous task' },
  { id: 'list.open', keys: ['enter'], context: 'list', group: 'Task list', label: 'Open focused task' },

  // ── Kanban (mouse binding, display only) ──
  { id: 'kanban.toggleDone', keys: ['mod+click'], context: 'project', group: 'Kanban', label: 'Toggle task done', displayOnly: true },

  // ── Task detail ──
  { id: 'task.done', keys: ['t'], context: 'taskDetail', group: 'Task detail', label: 'Toggle done' },
  { id: 'task.assign', keys: ['a'], context: 'taskDetail', group: 'Task detail', label: 'Assign to a user' },
  { id: 'task.labels', keys: ['l'], context: 'taskDetail', group: 'Task detail', label: 'Add labels' },
  { id: 'task.dueDate', keys: ['d'], context: 'taskDetail', group: 'Task detail', label: 'Change due date' },
  { id: 'task.move', keys: ['m'], context: 'taskDetail', group: 'Task detail', label: 'Move to project' },
  { id: 'task.color', keys: ['c'], context: 'taskDetail', group: 'Task detail', label: 'Change color' },
  { id: 'task.priority', keys: ['p'], context: 'taskDetail', group: 'Task detail', label: 'Change priority' },
  { id: 'task.delete', keys: ['backspace'], context: 'taskDetail', group: 'Task detail', label: 'Delete task' },
  { id: 'task.favorite', keys: ['s'], context: 'taskDetail', group: 'Task detail', label: 'Toggle favorite' },
  { id: 'task.openProject', keys: ['u'], context: 'taskDetail', group: 'Task detail', label: 'Open the task’s project' },
  { id: 'task.copyId', keys: ['.'], context: 'taskDetail', group: 'Task detail', label: 'Copy identifier' },
  { id: 'task.copyIdTitle', keys: ['.', '.'], context: 'taskDetail', group: 'Task detail', label: 'Copy identifier + title' },
  { id: 'task.copyIdTitleUrl', keys: ['.', '.', '.'], context: 'taskDetail', group: 'Task detail', label: 'Copy identifier, title + link' },
  { id: 'task.copyUrl', keys: ['mod+.'], context: 'taskDetail', group: 'Task detail', label: 'Copy link' },
];

export const MATCHABLE_SHORTCUTS = SHORTCUTS.filter((s) => !s.displayOnly);
