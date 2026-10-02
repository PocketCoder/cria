import { useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { generate } from '@/tauri/ai';
import { aiErrorMessage, parseLines, subtaskPrompt, SUBTASK_INSTRUCTIONS } from '@/lib/aiPrompts';
import { cn } from '@/lib/cn';

interface Suggestion {
  title: string;
  include: boolean;
}

/**
 * "Break down": the on-device model suggests subtasks for a task; the user
 * ticks the ones to keep. Rendered only when the model is available (the
 * caller checks useAiAvailable). Creation is the caller's, so subtasks go
 * through the same create + relate path as manual ones.
 */
export function BreakDown({
  title,
  description,
  existing,
  onAdd,
}: {
  title: string;
  description: string | null;
  /** Current subtask titles, skipped from suggestions. */
  existing: string[];
  onAdd: (titles: string[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  const suggest = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await generate({
        title: 'Breaking down a task',
        instructions: SUBTASK_INSTRUCTIONS,
        prompt: subtaskPrompt(title, description),
      });
      const taken = new Set([title, ...existing].map((t) => t.toLowerCase()));
      const lines = parseLines(out, 10).filter((l) => !taken.has(l.toLowerCase()));
      if (lines.length === 0) setError('No subtasks suggested. Try adding some notes first.');
      else setSuggestions(lines.map((t) => ({ title: t, include: true })));
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const chosen = suggestions?.filter((s) => s.include && s.title.trim()).map((s) => s.title.trim()) ?? [];
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      await onAdd(chosen);
      setSuggestions(null);
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!suggestions) {
    return (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => void suggest()}
          className="flex items-center gap-2 rounded-md px-1 py-1.5 text-[13.5px] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : <Sparkles className="h-[15px] w-[15px]" />}
          {busy ? 'Thinking…' : 'Break down'}
        </button>
        {error && <p className="basis-full px-1 text-[12px] text-[var(--color-destructive)]">{error}</p>}
      </>
    );
  }

  const count = suggestions.filter((s) => s.include).length;
  return (
    <div className="mt-1 basis-full rounded-md border border-[var(--color-border)] p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--color-muted-foreground)]">
          <Sparkles className="h-3 w-3" /> Suggested subtasks
        </span>
        <button
          type="button"
          onClick={() => setSuggestions(null)}
          aria-label="Dismiss suggestions"
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {suggestions.map((s, i) => (
        <div key={i} className="flex items-center gap-2 py-1 text-[13.5px]">
          <input
            aria-label={`Include ${s.title}`}
            type="checkbox"
            checked={s.include}
            onChange={(e) =>
              setSuggestions((prev) => prev!.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))
            }
            className="h-3.5 w-3.5 shrink-0 accent-[var(--color-primary)]"
          />
          <input
            aria-label="Subtask"
            type="text"
            value={s.title}
            onChange={(e) =>
              setSuggestions((prev) => prev!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
            }
            className={cn(
              'min-w-0 flex-1 bg-transparent focus:outline-none',
              !s.include && 'text-[var(--color-muted-foreground)] line-through',
            )}
          />
        </div>
      ))}
      {error && <p className="text-[12px] text-[var(--color-destructive)]">{error}</p>}
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          disabled={busy || count === 0}
          onClick={() => void add()}
          className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-1 text-[12.5px] font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Add {count}
        </button>
      </div>
    </div>
  );
}
