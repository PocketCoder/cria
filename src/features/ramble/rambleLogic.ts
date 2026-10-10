import type { Project } from '@/domain/project';
import { parseQuickAdd } from '@/lib/quickAddParser';
import { QUICK_ADD_PREFIXES, type QuickAddMagicMode } from '@/lib/quickAddPrefixes';
import type { ActiveView } from '@/stores/ui';

export type Phase = 'review' | 'saving';

export interface Draft {
  id: number;
  line: string;
  include: boolean;
  /**
   * Quick-add tokens the model only suggested (a project or label that fits the
   * subject but was not named). Never applied unless the user accepts them.
   */
  suggestion?: string;
  /** Extra detail the model moved out of a long title; saved as the task description. */
  notes?: string;
}

/** Split a model line "Title ~ +Flat || extra detail" into the rest and its notes. */
export function splitNotes(raw: string): { text: string; notes?: string } {
  const i = raw.indexOf(' || ');
  if (i < 0) return { text: raw };
  const notes = raw.slice(i + 4).trim();
  return notes ? { text: raw.slice(0, i), notes } : { text: raw.slice(0, i) };
}

/** A draft written back as a model line, so rows kept for a later open lose nothing. */
export function draftToRaw(d: Draft): string {
  return `${d.line}${d.suggestion ? ` ~ ${d.suggestion}` : ''}${d.notes ? ` || ${d.notes}` : ''}`;
}

/** Plain notes as the HTML the task editor stores. */
export function notesToHtml(notes: string): string {
  const esc = notes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p>${esc}</p>`;
}

/**
 * Split a model line "Title ~ +Flat *house" into the line and its suggestion.
 * With Quick Add Magic off the model writes no tokens, so nothing is split.
 */
export function splitSuggestion(
  raw: string,
  mode: QuickAddMagicMode = 'vikunja',
): { line: string; suggestion?: string } {
  if (!QUICK_ADD_PREFIXES[mode]) return { line: raw.trim() };
  const m = /^(.*?)\s+~\s+(.+)$/.exec(raw);
  const line = (m ? m[1]! : raw).trim();
  const suggestion = m ? m[2]!.trim() : '';
  return suggestion ? { line, suggestion } : { line };
}

export interface SuggestionContext {
  projects: readonly Pick<Project, 'title'>[];
  labels: readonly { title: string }[];
  mode: QuickAddMagicMode;
}

/**
 * The parts of a draft's suggestion worth offering: an existing project when
 * the line names none, and existing labels the line doesn't already carry.
 * Unknown names would fall back to the default project or create new labels.
 */
export function usableSuggestion(
  d: Draft,
  ctx: SuggestionContext,
): { project?: string; labels: string[] } {
  if (!d.suggestion || !QUICK_ADD_PREFIXES[ctx.mode]) return { labels: [] };
  const now = new Date();
  const s = parseQuickAdd(`x ${d.suggestion}`, now, ctx.mode);
  const line = parseQuickAdd(`x ${d.line}`, now, ctx.mode);
  const project =
    s.projectTitle && !line.projectTitle ? findProjectByTitle(ctx.projects, s.projectTitle)?.title : undefined;
  const have = new Set(line.labelTitles.map((l) => l.toLowerCase()));
  const labels: string[] = [];
  for (const t of s.labelTitles) {
    const known = ctx.labels.find((l) => l.title.toLowerCase() === t.toLowerCase());
    if (!known || have.has(known.title.toLowerCase())) continue;
    have.add(known.title.toLowerCase());
    labels.push(known.title);
  }
  return project ? { project, labels } : { labels };
}

export function hasUsableSuggestion(d: Draft, ctx: SuggestionContext): boolean {
  const u = usableSuggestion(d, ctx);
  return !!u.project || u.labels.length > 0;
}

function token(prefix: string, name: string): string {
  return /^[A-Za-z0-9_-]+$/.test(name) ? `${prefix}${name}` : `${prefix}"${name}"`;
}

/** The draft with the usable part of its suggestion applied to the line. */
export function acceptSuggestion(d: Draft, ctx: SuggestionContext): Draft {
  if (d.suggestion === undefined) return d;
  const { suggestion: _drop, ...rest } = d;
  const p = QUICK_ADD_PREFIXES[ctx.mode];
  const u = usableSuggestion(d, ctx);
  if (!p) return rest;
  const tokens = [
    ...(u.project ? [token(p.project, u.project)] : []),
    ...u.labels.map((l) => token(p.label, l)),
  ];
  return tokens.length ? { ...rest, line: `${d.line.trim()} ${tokens.join(' ')}` } : rest;
}

export function acceptAllSuggestions(drafts: readonly Draft[], ctx: SuggestionContext): Draft[] {
  return drafts.map((d) => acceptSuggestion(d, ctx));
}

/** Drafts for freshly parsed lines, numbered from `firstId`. */
export function draftsFromLines(
  lines: readonly string[],
  firstId: number,
  mode: QuickAddMagicMode = 'vikunja',
): Draft[] {
  return lines.map((raw, i) => {
    const { text, notes } = splitNotes(raw);
    return { id: firstId + i, ...splitSuggestion(text, mode), ...(notes ? { notes } : {}), include: true };
  });
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
 * only tokens ("+Home tomorrow") has no title, and creation skips it. Typed
 * quick-add keeps such a line as a literal title instead, as Vikunja-web does
 * (parseQuickAddTask); a ramble shows it as skipped. A line wrapped in quotes
 * is a literal title in both.
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
