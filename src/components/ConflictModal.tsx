import { useConflicts } from '@/queries/conflicts';
import { getDb } from '@/db';
import { useState } from 'react';

interface ConflictModalProps {
  onClose: () => void;
}

export function ConflictModal({ onClose }: ConflictModalProps) {
  const { data: conflicts = [], isLoading, isError } = useConflicts();
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  const resolveConflict = async (id: number) => {
    setResolvingId(id);
    const db = await getDb();
    const now = new Date().toISOString();
    await db.execute(`UPDATE conflicts SET resolved_at = ? WHERE id = ?`, [now, id]);
    setResolvingId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-background)] rounded-lg shadow-lg w-11/12 max-w-3xl max-h-[80vh] overflow-auto p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Conflicts</h2>
          <button onClick={onClose} className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]">
            ✕
          </button>
        </div>
        {isLoading && <p>Loading…</p>}
        {isError && <p className="text-[var(--color-warning)]">Failed to load conflicts.</p>}
        {conflicts.length === 0 && <p>No conflicts.</p>}
        {conflicts.map((c) => (
          <div key={c.id} className="border-b py-2">
            <div className="flex justify-between items-center mb-2">
              <span className="font-medium">{c.entity_type} #{c.entity_local_id}</span>
              <button
                onClick={() => resolveConflict(c.id)}
                disabled={resolvingId === c.id}
                className="px-2 py-1 bg-[var(--color-primary)] text-white rounded"
              >
                {resolvingId === c.id ? 'Resolving…' : 'Mark Resolved'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="font-semibold mb-1">Local (pre‑sync)</h4>
                <pre className="whitespace-pre-wrap bg-[var(--color-muted)] p-2 rounded">{c.local_snapshot}</pre>
              </div>
              <div>
                <h4 className="font-semibold mb-1">Remote</h4>
                <pre className="whitespace-pre-wrap bg-[var(--color-muted)] p-2 rounded">{c.remote_snapshot}</pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
