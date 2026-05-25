import { useState } from 'react';
import { createTask } from '@/db/tasks';
import { useUi } from '@/stores/ui';
import { X } from 'lucide-react';

/** Simple modal for fast task creation (global shortcut Cmd+Shift+A). */
export function QuickAddModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const selectedProjectId = useUi((s) => s.selectedProjectLocalId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !selectedProjectId) return;
    try {
      await createTask({ title: title.trim(), projectLocalId: selectedProjectId });
    } catch (err) {
      console.error('Quick add failed', err);
    }
    setTitle('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-background)] rounded-lg shadow-lg w-11/12 max-w-md p-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-semibold">Quick Add</h2>
          <button onClick={onClose} className="p-1 hover:text-[var(--color-primary)]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            placeholder="Task title…"
            className="flex-1 bg-transparent border-b border-[var(--color-border)] py-1 focus:outline-none"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <button type="submit" className="px-3 py-1 bg-[var(--color-primary)] text-white rounded">
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
