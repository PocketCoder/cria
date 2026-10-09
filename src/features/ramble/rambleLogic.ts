import type { Project } from '@/domain/project';
import { parseQuickAdd } from '@/lib/quickAddParser';
import type { QuickAddMagicMode } from '@/lib/quickAddPrefixes';
import type { ActiveView } from '@/stores/ui';

export type Phase = 'input' | 'thinking' | 'review' | 'saving';

export interface Draft {
  id: number;
  line: string;
  include: boolean;
}

/** Drafts for freshly parsed lines, numbered from `firstId`. */
export function draftsFromLines(lines: readonly string[], firstId: number): Draft[] {
  return lines.map((line, i) => ({ id: firstId + i, line, include: true }));
}

/**
 * Whether a line still has a title once its quick-add tokens are stripped.
 *
 * Ramble lines are written and parsed in the user's Quick Add Magic `mode`:
 * the model is prompted with that mode's syntax (see rambleInstructions), and
 * every ramble parse must pass the same mode.
 */
export function hasTitle(line: string, mode: QuickAddMagicMode): boolean {
  return parseQuickAdd(line.trim(), new Date(), mode).title !== '';
}

/**
 * Drafts that will actually be created: ticked and with a title. A line of
 * only tokens ("+Home tomorrow") has no title, and creation skips it.
 */
export function chosenDrafts(drafts: readonly Draft[], mode: QuickAddMagicMode): Draft[] {
  return drafts.filter((d) => d.include && hasTitle(d.line, mode));
}

/** The project a `+Name` token refers to, matched case-insensitively. */
export function findProjectByTitle<T extends Pick<Project, 'title'>>(
  projects: readonly T[],
  title: string,
): T | undefined {
  const wanted = title.toLowerCase();
  return projects.find((p) => p.title.toLowerCase() === wanted);
}

/**
 * Preview for a `+Name` token: the project it resolves to, or (unknown name)
 * the fallback project it will really land in.
 */
export function projectPreview(
  projects: readonly Pick<Project, 'localId' | 'title'>[],
  requested: string,
  fallbackProjectId: string,
): { text: string; unresolved: boolean } {
  const found = findProjectByTitle(projects, requested);
  if (found) return { text: found.title, unresolved: false };
  const fallback = projects.find((p) => p.localId === fallbackProjectId);
  return {
    text: fallback ? `No “${requested}”, using ${fallback.title}` : `No project “${requested}”`,
    unresolved: true,
  };
}

export function patchDraft(drafts: readonly Draft[], id: number, patch: Partial<Draft>): Draft[] {
  return drafts.map((d) => (d.id === id ? { ...d, ...patch } : d));
}

export function removeDraft(drafts: readonly Draft[], id: number): Draft[] {
  return drafts.filter((d) => d.id !== id);
}

/** Drafts left to save after `savedIds` were created, so a retry skips them. */
export function withoutSaved(drafts: readonly Draft[], savedIds: ReadonlySet<number>): Draft[] {
  return drafts.filter((d) => !savedIds.has(d.id));
}

/**
 * Create `chosen` in order, calling `onSaved` after each succeeds. Stops and
 * rethrows on the first failure, so the caller knows exactly which were saved.
 */
export async function createDrafts(
  chosen: readonly Draft[],
  create: (draft: Draft) => Promise<void>,
  onSaved: (draft: Draft) => void,
): Promise<void> {
  for (const d of chosen) {
    await create(d);
    onSaved(d);
  }
}

export function appendBlankDraft(drafts: readonly Draft[], id: number): Draft[] {
  return [...drafts, { id, line: '', include: true }];
}

/** "3 tasks" / "1 task". */
export function taskCount(n: number): string {
  return `${n} task${n === 1 ? '' : 's'}`;
}

/**
 * Project that tasks without a (known) +project land in: the open project if
 * there is one, else the first. `''` while projects are still loading.
 */
export function defaultProjectId(
  projects: readonly Pick<Project, 'localId'>[],
  activeView: ActiveView | null,
): string {
  if (projects.length === 0) return '';
  const open = activeView?.kind === 'project' ? activeView.localId : null;
  return projects.find((p) => p.localId === open)?.localId ?? projects[0]!.localId;
}

export function dictationHint(mobile: boolean): string {
  return mobile
    ? 'Tap the microphone on the keyboard and talk.'
    : 'Press the dictation key (or fn twice) and talk.';
}
