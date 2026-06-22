import { useState } from 'react';
import { useOutboxRows, useDeadLetters } from '@/queries/outboxRows';
import { retryDeadLetter } from '@/sync/push';

interface OutboxModalProps {
  onClose: () => void;
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="glass-surface rounded-lg shadow-lg w-11/12 max-w-2xl max-h-[80vh] overflow-auto p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Pending Mutations</h2>
          <button onClick={onClose} className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]">
            ✕
          </button>
        </div>

        {isLoading && <p>Loading…</p>}
        {isError && <p className="text-[var(--color-warning)]">Failed to load outbox.</p>}
        {!isLoading && rows.length === 0 && deadRows.length === 0 && <p>No pending mutations.</p>}
        {rows.length > 0 && (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1">ID</th>
                <th className="text-left py-1">Entity</th>
                <th className="text-left py-1">Op</th>
                <th className="text-left py-1">Attempts</th>
                <th className="text-left py-1">Last error</th>
                <th className="text-left py-1">Payload</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="py-1">{row.id}</td>
                  <td className="py-1">{row.entity_type}</td>
                  <td className="py-1">{row.op}</td>
                  <td className="py-1">{row.attempts}</td>
                  <td className="py-1 max-w-[16ch] truncate" title={row.last_error ?? ''}>
                    {row.last_error ?? '—'}
                  </td>
                  <td className="py-1 break-all">
                    <pre className="whitespace-pre-wrap">{JSON.stringify(JSON.parse(row.payload), null, 2)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {deadRows.length > 0 && (
          <>
            <div className="flex justify-between items-center mt-6 mb-2">
              <h3 className="text-base font-semibold text-[var(--color-warning)]">
                Failed to sync ({deadRows.length})
              </h3>
              <button
                onClick={() => void retryAll()}
                className="text-sm underline text-[var(--color-primary)] disabled:opacity-50"
                disabled={retrying.size > 0}
              >
                Retry all
              </button>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)] mb-2">
              These operations exhausted their automatic retries. Retrying re-queues
              them for the next sync.
            </p>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1">Entity</th>
                  <th className="text-left py-1">Op</th>
                  <th className="text-left py-1">Failed at</th>
                  <th className="text-left py-1">Last error</th>
                  <th className="text-left py-1"></th>
                </tr>
              </thead>
              <tbody>
                {deadRows.map((row) => (
                  <tr key={row.id} className="border-b align-top">
                    <td className="py-1">{row.entity_type}</td>
                    <td className="py-1">{row.op}</td>
                    <td className="py-1 whitespace-nowrap">{row.failed_at.slice(0, 19).replace('T', ' ')}</td>
                    <td className="py-1 max-w-[24ch] truncate" title={row.last_error ?? ''}>
                      {row.last_error ?? '—'}
                    </td>
                    <td className="py-1">
                      <button
                        onClick={() => void retry(row.id)}
                        className="text-sm underline text-[var(--color-primary)] disabled:opacity-50"
                        disabled={retrying.has(row.id)}
                      >
                        {retrying.has(row.id) ? 'Retrying…' : 'Retry'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
