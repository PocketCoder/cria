import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { generate } from '@/tauri/ai';
import { aiErrorMessage, cleanFilter, filterInstructions } from '@/lib/aiPrompts';
import { parseFilterQuery } from '@/lib/filterQueryParser';
import { useProjects } from '@/queries/projects';
import { useLabels } from '@/queries/labels';

/**
 * "Describe it in words" → filter query, via the on-device model. The result
 * must pass the same parser Save uses; on a parse error the model gets one
 * retry with the error fed back, then the user sees it in the query box to fix.
 */
export function DescribeFilter({ onQuery }: { onQuery: (q: string) => void }) {
  const { data: projects = [] } = useProjects();
  const { data: labels = [] } = useLabels();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    const instructions = filterInstructions({
      projects: projects.map((p) => p.title),
      labels: labels.map((l) => l.title),
    });
    const ask = (prompt: string) =>
      generate({ title: 'Writing a filter', instructions, prompt }).then(cleanFilter);
    try {
      let q = await ask(text.trim());
      try {
        parseFilterQuery(q, new Date());
      } catch (err) {
        // ponytail: one repair attempt; more rarely helps a small model
        q = await ask(
          `${text.trim()}\n\nYour previous answer "${q}" was invalid: ${String(err instanceof Error ? err.message : err)}. Answer again with a valid query.`,
        );
      }
      onQuery(q);
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <input
          aria-label="Describe the filter"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void run();
            }
          }}
          placeholder="Describe it: overdue work tasks with high priority"
          className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
        />
        <button
          type="button"
          disabled={!text.trim() || busy}
          onClick={() => void run()}
          aria-label="Write the filter query"
          title="Write the query for me (on-device)"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 text-xs font-medium hover:bg-[var(--color-muted)] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Write
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-[var(--color-destructive)]">{error}</p>}
    </div>
  );
}
