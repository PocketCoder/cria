import { useState, useRef } from 'react';
import { useLabels } from '@/queries/labels';
import {
  createLabel,
  updateLabel,
  deleteLabel,
} from '@/db/labels';
import {
  X,
  Plus,
  Pencil,
  Trash2,
  Check,
  Loader2,
} from 'lucide-react';

interface LabelManagerModalProps {
  onClose: () => void;
}

export function LabelManagerModal({ onClose }: LabelManagerModalProps) {
  const { data: labels = [], isLoading, isError, refetch } = useLabels();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingColor, setEditingColor] = useState('');
  const [busy, setBusy] = useState(false);
  const creatingRef = useRef(false);

  const handleCreate = async () => {
    if (creatingRef.current) return;
    const title = newTitle.trim();
    if (!title) {
      setCreating(false);
      setNewTitle('');
      return;
    }
    creatingRef.current = true;
    setBusy(true);
    try {
      await createLabel({ title });
      await refetch();
    } catch (err) {
      console.error('[labels] createLabel failed:', err);
    } finally {
      creatingRef.current = false;
      setBusy(false);
      setCreating(false);
      setNewTitle('');
    }
  };

  const handleRenameSave = async (localId: string) => {
    const title = editingTitle.trim();
    if (!title) return;
    try {
      await updateLabel(localId, {
        title,
        ...(editingColor ? { hexColor: editingColor } : {}),
      });
      await refetch();
    } catch (err) {
      console.error('[labels] updateLabel failed:', err);
    } finally {
      setEditingId(null);
      setEditingTitle('');
      setEditingColor('');
    }
  };

  const startEdit = (label: { localId: string; title: string; hexColor: string | null }) => {
    setEditingId(label.localId);
    setEditingTitle(label.title);
    setEditingColor(label.hexColor ?? '');
  };

  const handleDelete = async (localId: string) => {
    try {
      await deleteLabel(localId);
      await refetch();
    } catch (err) {
      console.error('[labels] deleteLabel failed:', err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-11/12 max-w-lg flex-col overflow-hidden rounded-lg bg-[var(--color-background)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Manage labels</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <p className="py-4 text-center text-sm text-[var(--color-muted-foreground)]">
              Loading…
            </p>
          ) : isError ? (
            <p className="py-4 text-center text-sm text-[var(--color-destructive)]">
              Failed to load labels.
            </p>
          ) : (
            <ul className="space-y-1">
              {labels.map((label) => (
                <li key={label.localId}>
                  {editingId === label.localId ? (
                    <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5">
                      <input
                        type="color"
                        value={editingColor || '#000000'}
                        onChange={(e) => setEditingColor(e.target.value)}
                        className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                      />
                      <input
                        type="text"
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleRenameSave(label.localId);
                          } else if (e.key === 'Escape') {
                            setEditingId(null);
                          }
                        }}
                        className="min-w-0 flex-1 rounded bg-transparent px-1 text-sm focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleRenameSave(label.localId)}
                        className="rounded p-0.5 text-[var(--color-primary)] hover:bg-[var(--color-muted)]"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--color-muted)]">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          background: label.hexColor || 'var(--color-muted-foreground)',
                        }}
                      />
                      <span className="flex-1 truncate text-sm">{label.title}</span>
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => startEdit(label)}
                          className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-background)]"
                          aria-label="Rename"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(label.localId)}
                          className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] hover:bg-[var(--color-background)]"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}

              {creating ? (
                <li className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5">
                  <input
                    type="text"
                    autoFocus
                    value={newTitle}
                    disabled={busy}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleCreate();
                      } else if (e.key === 'Escape') {
                        setCreating(false);
                        setNewTitle('');
                      }
                    }}
                    placeholder="New label name…"
                    className="min-w-0 flex-1 rounded bg-transparent px-1 text-sm focus:outline-none"
                  />
                </li>
              ) : (
                <li>
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    New label
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
