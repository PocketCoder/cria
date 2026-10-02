import { Camera, Loader2, Plus, Trash2, Sparkles, Undo2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Project } from '@/domain/project';
import type { OcrEngine } from './ocr';
import {
  addButtonLabel,
  removeItem,
  selectedLabel,
  setItemIncluded,
  setItemText,
  type DraftItem,
} from './photoItems';

/** Idle / error state: one message and a button that re-opens the picker. */
export function PhotoPrompt({
  message,
  buttonLabel,
  className,
  messageClassName,
  onPick,
}: {
  message: string | null;
  buttonLabel: string;
  className: string;
  messageClassName: string;
  onPick: () => void;
}) {
  return (
    <div className={className}>
      <p className={messageClassName}>{message}</p>
      <button
        type="button"
        onClick={onPick}
        className="flex items-center gap-2 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
      >
        <Camera className="h-4 w-4" /> {buttonLabel}
      </button>
    </div>
  );
}

export function PhotoExtracting() {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-[var(--color-muted-foreground)]">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">Reading your list…</p>
    </div>
  );
}

interface ReviewProps {
  items: DraftItem[];
  setItems: (updater: (prev: DraftItem[]) => DraftItem[]) => void;
  includedCount: number;
  engine: OcrEngine | null;
  error: string | null;
  aiAvailable: boolean;
  tidying: boolean;
  onTidy: () => void;
  canUndoTidy: boolean;
  onUndoTidy: () => void;
  saving: boolean;
  projects: Project[];
  projectId: string;
  setProjectId: (id: string) => void;
  label: string;
  setLabel: (v: string) => void;
  onAddItem: () => void;
  onCancel: () => void;
  onCreate: () => void;
}

export function PhotoReview({
  items,
  setItems,
  includedCount,
  engine,
  error,
  aiAvailable,
  tidying,
  onTidy,
  canUndoTidy,
  onUndoTidy,
  saving,
  projects,
  projectId,
  setProjectId,
  label,
  setLabel,
  onAddItem,
  onCancel,
  onCreate,
}: ReviewProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-caption text-[var(--color-muted-foreground)]">
        <span>{selectedLabel(includedCount)}</span>
        {aiAvailable ? (
          <span className="flex items-center gap-3">
            {canUndoTidy && (
              <button
                type="button"
                disabled={tidying || saving}
                onClick={onUndoTidy}
                title="Restore the list as it was before tidying"
                className="flex items-center gap-1 hover:text-[var(--color-foreground)] disabled:opacity-60"
              >
                <Undo2 className="h-3 w-3" /> Undo tidy
              </button>
            )}
            <button
              type="button"
              disabled={tidying || saving}
              onClick={onTidy}
              title="Fix misreadings and drop prices/headings (on-device)"
              className="flex items-center gap-1 hover:text-[var(--color-foreground)] disabled:opacity-60"
            >
              {tidying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {tidying ? 'Tidying…' : 'Tidy up'}
            </button>
          </span>
        ) : (
          engine === 'vision' && (
            <span className="flex items-center gap-1" title="Read on-device with Apple Vision">
              <Sparkles className="h-3 w-3" /> On-device
            </span>
          )
        )}
      </div>

      {error && <p className="text-caption text-[var(--color-destructive)]">{error}</p>}

      <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {items.map((item) => (
          <li key={item.id} className="group flex items-center gap-2">
            <input
              type="checkbox"
              checked={item.include}
              disabled={tidying}
              onChange={(e) => setItems((prev) => setItemIncluded(prev, item.id, e.target.checked))}
              className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
              aria-label={`Include ${item.text}`}
            />
            <input
              aria-label="Item text"
              type="text"
              value={item.text}
              disabled={tidying}
              onChange={(e) => setItems((prev) => setItemText(prev, item.id, e.target.value))}
              className={cn(
                'flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-[var(--color-border)] focus:border-[var(--color-ring)] focus:outline-none',
                !item.include && 'text-[var(--color-muted-foreground)] line-through',
              )}
            />
            <button
              type="button"
              disabled={tidying}
              onClick={() => setItems((prev) => removeItem(prev, item.id))}
              className="hover-reveal shrink-0 rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
              aria-label={`Remove ${item.text}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={tidying}
        onClick={onAddItem}
        className="flex items-center gap-1 text-caption text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-60"
      >
        <Plus className="h-3.5 w-3.5" /> Add item
      </button>

      <TargetFields
        projects={projects}
        projectId={projectId}
        setProjectId={setProjectId}
        label={label}
        setLabel={setLabel}
      />

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || tidying || includedCount === 0 || !projectId}
          onClick={onCreate}
          className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? 'Adding…' : addButtonLabel(includedCount)}
        </button>
      </div>
    </div>
  );
}

function TargetFields({
  projects,
  projectId,
  setProjectId,
  label,
  setLabel,
}: Pick<ReviewProps, 'projects' | 'projectId' | 'setProjectId' | 'label' | 'setLabel'>) {
  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
      <label className="flex items-center justify-between gap-2 text-caption">
        <span className="text-[var(--color-muted-foreground)]">Project</span>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger
            className="w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-sm"
            aria-label="Project"
          >
            <SelectValue placeholder="Select project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.localId} value={p.localId}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-border)]"
                    style={p.hexColor ? { backgroundColor: p.hexColor } : undefined}
                  />
                  {p.title}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center justify-between gap-2 text-caption">
        <span className="text-[var(--color-muted-foreground)]">Label (optional)</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. shopping"
          className="w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-sm placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
        />
      </label>
    </div>
  );
}
