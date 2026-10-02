import { useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { generate } from '@/tauri/ai';
import { aiErrorMessage, commentsPrompt, parseLines, SUMMARY_INSTRUCTIONS } from '@/lib/aiPrompts';
import type { TaskComment } from '@/db/comments';

/**
 * On-demand, on-device summary of a long comment thread. Not cached or
 * synced: it's a reading aid, regenerated when asked (threads change).
 */
export function ThreadSummary({ comments }: { comments: TaskComment[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<string[] | null>(null);

  const summarise = async () => {
    setBusy(true);
    setError(null);
    try {
      const ordered = [...comments].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
      const out = await generate({
        title: 'Summarising comments',
        instructions: SUMMARY_INSTRUCTIONS,
        prompt: commentsPrompt(ordered),
      });
      setPoints(parseLines(out, 6));
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!points) {
    return (
      <div className="px-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => void summarise()}
          className="flex items-center gap-1 text-footnote text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {busy ? 'Summarising…' : `Summarise ${comments.length} comments`}
        </button>
        {error && <p className="mt-1 text-xs text-[var(--color-destructive)]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-md bg-[var(--color-muted)] px-3 py-2 text-[13px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1 text-footnote text-[var(--color-muted-foreground)]">
          <Sparkles className="h-3 w-3" /> Summary
        </span>
        <button
          type="button"
          onClick={() => setPoints(null)}
          aria-label="Hide summary"
          className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <ul className="list-disc space-y-0.5 pl-4">
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </div>
  );
}
