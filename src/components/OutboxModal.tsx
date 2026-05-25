import { useState } from 'react';
import { useOutboxRows } from '@/queries/outboxRows';
import { drainOutbox } from '@/sync/push';

interface OutboxModalProps {
  onClose: () => void;
}

interface DrainState {
  status: 'idle' | 'running' | 'done' | 'error';
  detail?: string;
}

export function OutboxModal({ onClose }: OutboxModalProps) {
  const { data: rows = [], isLoading, isError } = useOutboxRows();
  const [drain, setDrain] = useState<DrainState>({ status: 'idle' });

  const runDrain = async () => {
    setDrain({ status: 'running' });
    try {
      await drainOutbox();
      setDrain({ status: 'done' });
    } catch (err) {
      console.error('[outbox] manual drain failed:', err);
      setDrain({
        status: 'error',
        detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-background)] rounded-lg shadow-lg w-11/12 max-w-2xl max-h-[80vh] overflow-auto p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Pending Mutations</h2>
          <button onClick={onClose} className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]">
            ✕
          </button>
        </div>

        <div className="mb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void runDrain()}
            disabled={drain.status === 'running' || rows.length === 0}
            className="rounded-md border border-[var(--color-border)] px-3 py-1 text-xs hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            {drain.status === 'running' ? 'Draining…' : 'Drain now'}
          </button>
          {drain.status === 'done' ? (
            <span className="text-xs text-[var(--color-success)]">
              Drain completed.
            </span>
          ) : null}
          {drain.status === 'error' ? (
            <span className="text-xs text-[var(--color-destructive)]" title={drain.detail}>
              {drain.detail}
            </span>
          ) : null}
        </div>

        {isLoading && <p>Loading…</p>}
        {isError && <p className="text-[var(--color-warning)]">Failed to load outbox.</p>}
        {!isLoading && rows.length === 0 && <p>No pending mutations.</p>}
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
      </div>
    </div>
  );
}
