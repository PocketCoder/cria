/**
 * Quick Add Magic prefix modes, mirroring Vikunja-web's
 * `src/modules/quickAddMagic/prefixes.ts` (`PrefixMode` / `PREFIXES`).
 *
 * The mode is a per-user Vikunja setting stored in
 * `settings.frontend_settings.quick_add_magic_mode`, so Cria reads and writes
 * the same key and the web and desktop clients agree (see settingsSync).
 *
 * Kept apart from quickAddParser so the settings store can import the mode
 * type and default without pulling in chrono-node.
 */

export type QuickAddMagicMode = 'disabled' | 'vikunja' | 'todoist';

export interface QuickAddPrefixes {
  label: string;
  project: string;
  assignee: string;
  priority: string;
}

export const QUICK_ADD_MAGIC_MODES: readonly QuickAddMagicMode[] = ['disabled', 'vikunja', 'todoist'];

/** Vikunja-web's default (`PrefixMode.Default`). */
export const DEFAULT_QUICK_ADD_MAGIC_MODE: QuickAddMagicMode = 'vikunja';

/** `null` for `disabled`: no symbol parsing at all. */
export const QUICK_ADD_PREFIXES: Readonly<Record<QuickAddMagicMode, QuickAddPrefixes | null>> = {
  disabled: null,
  vikunja: { label: '*', project: '+', assignee: '@', priority: '!' },
  todoist: { label: '@', project: '#', assignee: '+', priority: '!' },
};

export function isQuickAddMagicMode(value: unknown): value is QuickAddMagicMode {
  return typeof value === 'string' && (QUICK_ADD_MAGIC_MODES as readonly string[]).includes(value);
}
