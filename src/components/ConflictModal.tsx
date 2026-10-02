import { useState } from 'react';
import { useDateFormatter } from '@/lib/dateFormat';
import { useConflicts } from '@/queries/conflicts';
import {
  resolveConflictKeepMine,
  resolveConflictUseTheirs,
  diffConflict,
} from '@/db/conflicts';
import { X } from 'lucide-react';

interface ConflictModalProps {
  onClose: () => void;
}

interface ConflictRow {
  id: number;
  entity_type: string;
  entity_local_id: string;
  fields: string;
  local_snapshot: string;
  remote_snapshot: string;
  detected_at: string;
}

/**
 * Conflict resolution. Two plain-language option cards per conflict — yours
 * and the server's, each summarising the differing fields on one line — with
 * an all-or-nothing choice:
 *
 *   - Keep mine     — clears the conflict, outbox push wins
 *   - Keep server's — overwrites local from the remote snapshot
 *
 * No field-by-field diff; the one-line summary plus the choice is enough to
 * unstick people. Per-field merge is a larger follow-up.
 */
export function ConflictModal({ onClose }: ConflictModalProps) {
  const { data: conflicts = [], isLoading, isError } = useConflicts() as {
    data: ConflictRow[];
    isLoading: boolean;
    isError: boolean;
  };
  const [busyId, setBusyId] = useState<number | null>(null);

  const run = async (
    id: number,
    fn: (id: number) => Promise<void>,
  ): Promise<void> => {
    setBusyId(id);
    try {
      await fn(id);
    } catch (err) {
      console.error('[conflicts] resolve failed:', err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-[440px] flex-col overflow-hidden rounded-xl bg-[var(--color-card)] shadow-2xl dark:border dark:border-[var(--color-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <h2 className="text-[17px] font-semibold tracking-[-0.02em]">
            {conflicts.length > 1 ? 'These tasks changed in two places' : 'This task changed in two places'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 shrink-0 rounded-md p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
          {isLoading ? (
            <p className="py-6 text-sm text-[var(--color-muted-foreground)]">Loading…</p>
          ) : isError ? (
            <p className="py-6 text-sm text-[var(--color-destructive)]">Failed to load conflicts.</p>
          ) : conflicts.length === 0 ? (
            <p className="py-6 text-sm text-[var(--color-muted-foreground)]">
              Nothing to resolve — your local edits are in sync.
            </p>
          ) : (
            <ul className="flex flex-col gap-6">
              {conflicts.map((c) => (
                <ConflictItem
                  key={c.id}
                  conflict={c}
                  busy={busyId === c.id}
                  onKeepMine={() => run(c.id, resolveConflictKeepMine)}
                  onUseTheirs={() => run(c.id, resolveConflictUseTheirs)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function snapshotTitle(json: string): string | null {
  try {
    const t = (JSON.parse(json) as { title?: unknown }).title;
    return typeof t === 'string' && t.trim() ? t : null;
  } catch {
    return null;
  }
}

function ConflictItem({
  conflict,
  busy,
  onKeepMine,
  onUseTheirs,
}: {
  conflict: ConflictRow;
  busy: boolean;
  onKeepMine: () => void;
  onUseTheirs: () => void;
}) {
  const { formatDateTime } = useDateFormatter();
  const diffs = diffConflict(
    conflict.fields,
    conflict.local_snapshot,
    conflict.remote_snapshot,
  );
  const title = snapshotTitle(conflict.local_snapshot);
  const mine = diffs.map((d) => d.local).join(' · ') || 'No changes recorded';
  const theirs = diffs.map((d) => d.remote).join(' · ') || 'No changes recorded';
  let detected = conflict.detected_at;
  try {
    detected = formatDateTime(conflict.detected_at);
  } catch {
    // keep raw ISO
  }

  return (
    <li>
      <p className="mb-4 text-[13.5px] leading-relaxed text-[var(--color-muted-foreground)]">
        You edited{' '}
        {title ? (
          <strong className="font-semibold text-[var(--color-foreground)]">{title}</strong>
        ) : (
          'this task'
        )}{' '}
        offline while the server also changed it. Keep one.
      </p>

      <div className="flex flex-col gap-2">
        <div className="rounded-xl border-[1.5px] border-[var(--color-primary)] px-4 py-3">
          <p className="mb-1 group-label text-[var(--color-primary)]">
            Yours · edited {detected}
          </p>
          <p className="text-sm">{mine}</p>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] px-4 py-3">
          <p className="mb-1 group-label text-[var(--color-muted-foreground)]">
            Server
          </p>
          <p className="text-sm">{theirs}</p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onKeepMine}
          disabled={busy}
          className="flex-1 rounded-lg bg-[var(--color-inverse)] px-3 py-2.5 text-[13.5px] font-medium text-[var(--color-inverse-foreground)] disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Keep mine'}
        </button>
        <button
          type="button"
          onClick={onUseTheirs}
          disabled={busy}
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5 text-[13.5px] font-medium disabled:opacity-50"
        >
          {busy ? 'Working…' : "Keep server's"}
        </button>
      </div>
    </li>
  );
}
