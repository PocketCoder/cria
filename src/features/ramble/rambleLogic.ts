import type { Project } from '@/domain/project';
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

/** Drafts that will actually be created: ticked and not blank. */
export function chosenDrafts(drafts: readonly Draft[]): Draft[] {
  return drafts.filter((d) => d.include && d.line.trim());
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
