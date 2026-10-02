export interface Suggestion {
  title: string;
  include: boolean;
  /** Set once the task exists but is not yet linked, so a retry links it rather than re-creating. */
  createdId?: string;
}

/** A suggestion queued for saving; `index` is its position in the suggestion list. */
export interface SubtaskDraft {
  index: number;
  title: string;
  createdId?: string;
}

/** Progress callbacks, keyed by `SubtaskDraft.index`. */
export interface SubtaskProgress {
  onCreated: (index: number, localId: string) => void;
  onLinked: (index: number) => void;
}

/** Suggestions that will become subtasks: ticked and not blank. */
export function chosenSubtasks(suggestions: readonly Suggestion[]): SubtaskDraft[] {
  const out: SubtaskDraft[] = [];
  suggestions.forEach((s, index) => {
    const title = s.title.trim();
    if (s.include && title) out.push({ index, title, ...(s.createdId ? { createdId: s.createdId } : {}) });
  });
  return out;
}

/**
 * Create (unless already created) and link each draft in order. Stops and
 * rethrows on the first failure; `progress` has by then reported every task
 * created and every link made, so a retry only does the remainder.
 */
export async function addSubtasks(
  drafts: readonly SubtaskDraft[],
  deps: {
    create: (title: string) => Promise<string>;
    link: (localId: string) => Promise<void>;
  } & SubtaskProgress,
): Promise<void> {
  for (const d of drafts) {
    let id = d.createdId;
    if (!id) {
      id = await deps.create(d.title);
      deps.onCreated(d.index, id);
    }
    await deps.link(id);
    deps.onLinked(d.index);
  }
}

/** Suggestions after a (possibly partial) save: linked ones dropped, created-but-unlinked ones remembered. */
export function applyProgress(
  suggestions: readonly Suggestion[],
  created: ReadonlyMap<number, string>,
  linked: ReadonlySet<number>,
): Suggestion[] {
  return suggestions
    .map((s, i) => (created.has(i) ? { ...s, createdId: created.get(i)! } : s))
    .filter((_, i) => !linked.has(i));
}
