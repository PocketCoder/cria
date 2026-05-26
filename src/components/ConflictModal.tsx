import { useState } from 'react';
import { format } from 'date-fns';
import { useConflicts } from '@/queries/conflicts';
import {
  resolveConflictKeepMine,
  resolveConflictUseTheirs,
  diffConflict,
} from '@/db/conflicts';
import { AlertTriangle, X } from 'lucide-react';

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
 * Per-conflict resolution UI. Renders a field-by-field diff of the
 * fields the sync layer flagged as divergent, with two top-level
 * actions:
 *
 *   - Keep my version  — clears the conflict, outbox push wins
 *   - Use server's     — overwrites local from the remote snapshot
 *                        and drops the pending outbox entry
 *
 * Per-field merge ("keep this one, take that one") is a larger M3
 * follow-up; for now the all-or-nothing choice plus a clear diff is
 * enough to unstick people.
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-11/12 max-w-2xl flex-col overflow-hidden rounded-lg bg-[var(--color-background)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
            <h2 className="text-sm font-semibold">
              Conflicts
              {conflicts.length > 0 ? (
                <span className="ml-1 text-[var(--color-muted-foreground)]">
                  ({conflicts.length})
                </span>
              ) : null}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
              Loading…
            </p>
          ) : isError ? (
            <p className="p-6 text-sm text-[var(--color-destructive)]">
              Failed to load conflicts.
            </p>
          ) : conflicts.length === 0 ? (
            <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
              No conflicts. Your local edits are in sync with the server.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
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
  const diffs = diffConflict(
    conflict.fields,
    conflict.local_snapshot,
    conflict.remote_snapshot,
  );

  return (
    <li className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {conflict.entity_type}
          </p>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Detected {formatRelative(conflict.detected_at)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onKeepMine}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] px-3 py-1 text-xs hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Keep my version'}
          </button>
          <button
            type="button"
            onClick={onUseTheirs}
            disabled={busy}
            className="rounded-md bg-[var(--color-primary)] px-3 py-1 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Working…' : "Use server's"}
          </button>
        </div>
      </div>

      {diffs.length === 0 ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          No field-level diff recorded.
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
              <th className="w-[28%] py-1 pr-2 text-left font-medium">Field</th>
              <th className="w-[36%] py-1 pr-2 text-left font-medium">
                My version
              </th>
              <th className="w-[36%] py-1 text-left font-medium">
                Server's version
              </th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => (
              <tr
                key={d.field}
                className="align-top border-t border-[var(--color-border)]/60"
              >
                <td className="py-1.5 pr-2 font-medium">{d.label}</td>
                <td className="py-1.5 pr-2 break-words">{d.local}</td>
                <td className="py-1.5 break-words">{d.remote}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return format(d, sameYear ? 'd MMM HH:mm' : 'd MMM yyyy HH:mm');
  } catch {
    return iso;
  }
}
