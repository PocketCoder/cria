import { useConflicts } from '@/queries/conflicts';
import { getDb } from '@/db';
import { useState } from 'react';

interface ConflictModalProps {
  onClose: () => void;
}

export function ConflictModal({ onClose }: ConflictModalProps) {
  const { data: conflicts = [], isLoading, isError } = useConflicts();
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  const [action, setAction] = useState<string>('');
  const resolveConflict = async (id: number, act: 'keep' | 'theirs') => {
    setResolvingId(id);
    setAction(act);
    const db = await getDb();
    const now = new Date().toISOString();
    if (act === 'theirs') {
      // Apply remote snapshot to the local entity
      const conflictRows = await db.select<any[]>(`SELECT remote_snapshot, entity_type, entity_local_id FROM conflicts WHERE id = ?`, [id]);
      const conflict = conflictRows[0];
      if (conflict) {
        const remote = JSON.parse(conflict.remote_snapshot);
        // Simple upsert: reuse existing upsert helpers via raw SQL for tasks only (as example)
        if (conflict.entity_type === 'task') {
          // Update the task row with remote values, clear dirty flag
          const fields = [
            'title', 'description', 'done', 'done_at', 'due_date', 'start_date',
            'end_date', 'priority', 'percent_done', 'hex_color', 'position', 'updated_at'
          ];
          const setters: string[] = [];
          const params: any[] = [];
          for (const f of fields) {
            if (remote[f] !== undefined) {
              setters.push(`${f} = ?`);
              params.push(remote[f]);
            }
          }
          setters.push('dirty = 0');
          params.push(conflict.entity_local_id);
          await db.execute(`UPDATE tasks SET ${setters.join(', ')} WHERE local_id = ?`, params);
        }
        // Add similar branches for project/label if needed
      }
    }
    // Mark conflict resolved regardless of action
    await db.execute(`UPDATE conflicts SET resolved_at = ? WHERE id = ?`, [now, id]);
    setResolvingId(null);
    setAction('');
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
              <div className="flex gap-2">
              <button
                onClick={() => resolveConflict(c.id, 'keep')}
                disabled={resolvingId === c.id}
                className="px-2 py-1 bg-[var(--color-primary)] text-white rounded"
              >
                {resolvingId === c.id && action === 'keep' ? 'Resolving…' : 'Keep Mine'}
              </button>
              <button
                onClick={() => resolveConflict(c.id, 'theirs')}
                disabled={resolvingId === c.id}
                className="px-2 py-1 bg-[var(--color-primary)] text-white rounded"
              >
                {resolvingId === c.id && action === 'theirs' ? 'Resolving…' : 'Use Theirs'}
              </button>
            </div>
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
