import { useState } from 'react';
import {
  useOutboxRows,
  useDeadLetters,
  type OutboxRow,
  type DeadLetterRow,
} from '@/queries/outboxRows';
import {
  retryDeadLetter,
  discardOutboxOp,
  discardDeadLetter,
  clearDeadLetters,
} from '@/sync/push';
import { forceSync } from '@/sync/forceSync';
import { useSyncProgress } from '@/stores/syncProgress';
import { cn } from '@/lib/cn';
import { RefreshCw, Copy, Check, Trash2 } from 'lucide-react';

interface OutboxModalProps {
  onClose: () => void;
}

/** Copy text to the clipboard, with a hidden-textarea fallback for webviews
 * where the async clipboard API is unavailable. Never throws. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** One row → a plain-text block for the clipboard. */
function rowToText(row: OutboxRow | DeadLetterRow): string {
  const when =
    'failed_at' in row && row.failed_at ? ` failed=${row.failed_at}` : '';
  return [
    `#${row.id} ${row.entity_type}·${row.op} attempts=${row.attempts}${when}`,
    `  error: ${row.last_error ?? '(none)'}`,
    `  payload: ${row.payload}`,
  ].join('\n');
}

export function OutboxModal({ onClose }: OutboxModalProps) {
  const { data: rows = [], isLoading, isError } = useOutboxRows();
  const { data: deadRows = [] } = useDeadLetters();
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const currentStep = useSyncProgress((s) => s.currentStep);

  const setRowBusy = (id: number, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const flashCopied = (key: string) => {
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  const retry = async (id: number) => {
    setRowBusy(id, true);
    try {
      await retryDeadLetter(id);
    } catch (err) {
      console.error('[outbox] retry failed:', err);
    } finally {
      setRowBusy(id, false);
    }
  };

  const retryAll = async () => {
    for (const row of deadRows) await retry(row.id);
  };

  const discard = async (id: number, dead: boolean) => {
    setRowBusy(id, true);
    try {
      await (dead ? discardDeadLetter(id) : discardOutboxOp(id));
    } catch (err) {
      console.error('[outbox] discard failed:', err);
    } finally {
      setRowBusy(id, false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      await forceSync();
    } catch (err) {
      console.error('[outbox] sync now failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  const copyOne = async (row: OutboxRow | DeadLetterRow) => {
    if (await copyText(rowToText(row))) flashCopied(`row-${row.id}`);
  };

  const copyAll = async () => {
    const text = [
      `Cria sync queue — ${rows.length} queued, ${deadRows.length} failed`,
      rows.length ? `\n## Queued\n${rows.map(rowToText).join('\n\n')}` : '',
      deadRows.length ? `\n## Failed\n${deadRows.map(rowToText).join('\n\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    if (await copyText(text)) flashCopied('all');
  };

  const nothing = !isLoading && rows.length === 0 && deadRows.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        className="glass-surface flex max-h-[92vh] w-full flex-col rounded-t-2xl shadow-lg sm:max-h-[80vh] sm:w-11/12 sm:max-w-2xl sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header + action toolbar */}
        <div className="shrink-0 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-base font-semibold">Sync queue</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-2 px-4 pb-3">
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
              {syncing ? currentStep ?? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={() => void copyAll()}
              disabled={nothing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-muted)] disabled:opacity-50"
            >
              {copied === 'all' ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'all' ? 'Copied' : 'Copy all'}
            </button>
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto px-4 py-3"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
        >
          {isLoading && <p className="text-sm">Loading…</p>}
          {isError && (
            <p className="text-sm text-[var(--color-warning)]">Failed to load outbox.</p>
          )}
          {nothing && (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Nothing queued — everything's synced. 🎉
            </p>
          )}

          {rows.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                Queued ({rows.length})
              </h3>
              <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
                The first row is the FIFO blocker — its error explains why the queue
                is stuck. Discard it to let the rest through.
              </p>
              <ul className="flex flex-col gap-2">
                {rows.map((row, i) => (
                  <li key={row.id}>
                    <OpCard
                      row={row}
                      highlight={i === 0}
                      busy={busy.has(row.id)}
                      copied={copied === `row-${row.id}`}
                      onCopy={() => void copyOne(row)}
                      onDiscard={() => void discard(row.id, false)}
                    />
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
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void retryAll()}
                    disabled={busy.size > 0}
                    className="text-xs font-medium text-[var(--color-primary)] underline disabled:opacity-50"
                  >
                    Retry all
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearDeadLetters()}
                    className="text-xs font-medium text-[var(--color-muted-foreground)] underline hover:text-[var(--color-warning)]"
                  >
                    Clear all
                  </button>
                </div>
              </div>
              <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
                These exhausted their automatic retries. Retry re-queues them; clear
                discards them.
              </p>
              <ul className="flex flex-col gap-2">
                {deadRows.map((row) => (
                  <li key={row.id}>
                    <OpCard
                      row={row}
                      dead
                      busy={busy.has(row.id)}
                      copied={copied === `row-${row.id}`}
                      onCopy={() => void copyOne(row)}
                      onRetry={() => void retry(row.id)}
                      onDiscard={() => void discard(row.id, true)}
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

/* ── single-row card ───────────────────────────────────────── */
function OpCard({
  row,
  highlight,
  dead,
  busy,
  copied,
  onCopy,
  onRetry,
  onDiscard,
}: {
  row: OutboxRow | DeadLetterRow;
  highlight?: boolean;
  dead?: boolean;
  busy?: boolean;
  copied?: boolean;
  onCopy: () => void;
  onRetry?: () => void;
  onDiscard: () => void;
}) {
  const failedAt =
    'failed_at' in row && row.failed_at
      ? row.failed_at.slice(0, 19).replace('T', ' ')
      : null;
  return (
    <div
      className={cn(
        'rounded-lg border bg-[var(--color-card)] p-3',
        highlight ? 'border-[var(--color-warning)] shadow-sm' : 'border-[var(--color-border)]',
        busy && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="font-mono text-xs font-medium text-[var(--color-foreground)]">
          {row.entity_type} · {row.op}
        </span>
        <span className="whitespace-nowrap text-[10px] text-[var(--color-muted-foreground)]">
          #{row.id} · {row.attempts} attempt{row.attempts === 1 ? '' : 's'}
          {failedAt ? ` · ${failedAt}` : ''}
        </span>
      </div>

      {row.last_error ? (
        <p
          className={cn(
            'mt-2 break-words text-xs leading-snug',
            dead || highlight ? 'text-[var(--color-warning)]' : 'text-[var(--color-foreground)]',
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
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre rounded-md bg-[var(--color-muted)] p-2 text-[10px] leading-snug">
          {safeFormatJson(row.payload)}
        </pre>
      </details>

      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        {dead && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs font-medium hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
            {busy ? 'Retrying…' : 'Retry'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Discard
        </button>
      </div>
    </div>
  );
}

/** Pretty-print JSON if we can; otherwise show the raw payload. Never throws. */
function safeFormatJson(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}
