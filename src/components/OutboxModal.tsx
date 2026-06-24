import { useState } from 'react';
import { useOutboxRows, useDeadLetters, type OutboxRow, type DeadLetterRow } from '@/queries/outboxRows';
import { retryDeadLetter } from '@/sync/push';
import { cn } from '@/lib/cn';

interface OutboxModalProps {
  onClose: () => void;
}

/**
 * Pending-mutations diagnostic — used by both the desktop footer button and
 * the mobile sync indicator in the header. Lists every queued outbox row and
 * every dead-lettered row with its entity/op, attempt count, last error and
 * (collapsed-by-default) payload. The first row in `rows` is the FIFO blocker:
 * its `last_error` explains why the queue is stuck.
 *
 * Layout is a responsive card list (not a wide table) so it works inside the
 * narrow iOS viewport without horizontal overflow. The container is a
 * bottom-sheet on mobile and a centred dialog on desktop.
 */
export function OutboxModal({ onClose }: OutboxModalProps) {
  const { data: rows = [], isLoading, isError } = useOutboxRows();
  const { data: deadRows = [] } = useDeadLetters();
  const [retrying, setRetrying] = useState<Set<number>>(new Set());

  const retry = async (id: number) => {
    setRetrying((prev) => new Set(prev).add(id));
    try {
      await retryDeadLetter(id);
    } catch (err) {
      console.error('[outbox] failed to retry dead letter:', err);
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const retryAll = async () => {
    for (const row of deadRows) await retry(row.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="glass-surface flex w-full max-h-[92vh] flex-col rounded-t-2xl shadow-lg sm:w-11/12 sm:max-w-2xl sm:max-h-[80vh] sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header — keeps Close reachable while the list scrolls. */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-base font-semibold">Pending mutations</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            ✕
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto px-4 py-3 safe-bottom"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
        >
          {isLoading && <p className="text-sm">Loading…</p>}
          {isError && (
            <p className="text-sm text-[var(--color-warning)]">
              Failed to load outbox.
            </p>
          )}
          {!isLoading && rows.length === 0 && deadRows.length === 0 && (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              No pending mutations.
            </p>
          )}

          {rows.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                Queued ({rows.length})
              </h3>
              <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
                The first row is the FIFO blocker — its error explains why the
                queue is stuck.
              </p>
              <ul className="flex flex-col gap-2">
                {rows.map((row, i) => (
                  <li key={row.id}>
                    <OpCard row={row} highlight={i === 0} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {deadRows.length > 0 && (
            <section className={cn(rows.length > 0 && 'mt-6')}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-warning)]">
                  Failed to sync ({deadRows.length})
                </h3>
                <button
                  type="button"
                  onClick={() => void retryAll()}
                  disabled={retrying.size > 0}
                  className="text-xs font-medium text-[var(--color-primary)] underline disabled:opacity-50"
                >
                  Retry all
                </button>
              </div>
              <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
                These operations exhausted their automatic retries. Retrying
                re-queues them for the next sync.
              </p>
              <ul className="flex flex-col gap-2">
                {deadRows.map((row) => (
                  <li key={row.id}>
                    <OpCard
                      row={row}
                      dead
                      retrying={retrying.has(row.id)}
                      onRetry={() => void retry(row.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── single-row card ─────────────────────────────────────────
   Stacked, wrap-friendly layout: header chip row, error block, then a
   collapsible payload. The payload <pre> is the only horizontally-scrollable
   element — long JSON lines scroll *inside* the card instead of pushing the
   viewport. */
function OpCard({
  row,
  highlight,
  dead,
  retrying,
  onRetry,
}: {
  row: OutboxRow | DeadLetterRow;
  highlight?: boolean;
  dead?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  const failedAt =
    'failed_at' in row && row.failed_at
      ? row.failed_at.slice(0, 19).replace('T', ' ')
      : null;
  return (
    <div
      className={cn(
        'rounded-lg border bg-[var(--color-card)] p-3',
        highlight
          ? 'border-[var(--color-warning)] shadow-sm'
          : 'border-[var(--color-border)]',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="font-mono text-xs font-medium text-[var(--color-foreground)]">
          {row.entity_type} · {row.op}
        </span>
        <span className="text-[10px] text-[var(--color-muted-foreground)] whitespace-nowrap">
          #{row.id} · {row.attempts} attempt{row.attempts === 1 ? '' : 's'}
          {failedAt ? ` · ${failedAt}` : ''}
        </span>
      </div>

      {row.last_error ? (
        <p
          className={cn(
            'mt-2 text-xs leading-snug break-words',
            dead || highlight
              ? 'text-[var(--color-warning)]'
              : 'text-[var(--color-foreground)]',
          )}
        >
          {row.last_error}
        </p>
      ) : (
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
          No error reported yet.
        </p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
          Payload
        </summary>
        <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-[var(--color-muted)] p-2 text-[10px] leading-snug whitespace-pre">
          {safeFormatJson(row.payload)}
        </pre>
      </details>

      {dead && onRetry ? (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="rounded-md border border-[var(--color-border)] px-3 py-1 text-xs font-medium hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Pretty-print JSON if we can; otherwise show the raw payload. Never throw —
 * a malformed payload (corruption, future migration) shouldn't crash the
 * diagnostic that's there to surface problems. */
function safeFormatJson(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}
