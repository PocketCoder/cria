import { useState } from 'react';
import { Plus } from 'lucide-react';
import { createBucket } from '@/db/buckets';

export function AddBucketColumn({ viewLocalId }: { viewLocalId: string }) {
  const [showInput, setShowInput] = useState(false);
  const [title, setTitle] = useState('');

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await createBucket({ title: trimmed, viewLocalId });
      setTitle('');
      setShowInput(false);
    } catch (err) {
      console.error('[kanban] failed to create bucket:', err);
    }
  };

  if (showInput) {
    return (
      <div className="flex h-fit w-72 shrink-0 flex-col gap-2 rounded-lg border border-dashed border-[var(--color-border)] p-3">
        <input
          aria-label="New bucket name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void handleCreate(); }
            else if (e.key === 'Escape') { setShowInput(false); setTitle(''); }
          }}
          placeholder="Bucket name…"
          autoFocus
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-xs placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleCreate()}
            className="rounded bg-[var(--color-primary)] px-3 py-1 text-xs text-[var(--color-primary-foreground)] cursor-pointer hover:opacity-90"
          >
            Add
          </button>
          <button
            onClick={() => { setShowInput(false); setTitle(''); }}
            className="cursor-pointer text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowInput(true)}
      className="flex h-fit w-72 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-muted-foreground)] hover:border-solid hover:text-[var(--color-foreground)]"
    >
      <Plus className="h-4 w-4" />
      Add Column
    </button>
  );
}
