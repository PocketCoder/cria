import { createTask } from '@/db/tasks';
import { applyLabelsByTitle } from '@/db/labels';

export interface DraftItem {
  id: number;
  text: string;
  include: boolean;
}

/** Items that will become tasks: included and non-blank. */
export function selectedItems(items: DraftItem[]): DraftItem[] {
  return items.filter((i) => i.include && i.text.trim());
}

export function setItemIncluded(items: DraftItem[], id: number, include: boolean): DraftItem[] {
  return items.map((i) => (i.id === id ? { ...i, include } : i));
}

export function setItemText(items: DraftItem[], id: number, text: string): DraftItem[] {
  return items.map((i) => (i.id === id ? { ...i, text } : i));
}

export function removeItem(items: DraftItem[], id: number): DraftItem[] {
  return items.filter((i) => i.id !== id);
}

/** "3 items selected" / "1 item selected". */
export function selectedLabel(count: number): string {
  return `${count} item${count === 1 ? '' : 's'} selected`;
}

/** "Add 3 tasks" / "Add 1 task". */
export function addButtonLabel(count: number): string {
  return `Add ${count} task${count === 1 ? '' : 's'}`;
}

/** Items left to save after `savedIds` were created, so a retry skips them. */
export function withoutSaved(items: DraftItem[], savedIds: ReadonlySet<number>): DraftItem[] {
  return items.filter((i) => !savedIds.has(i.id));
}

/**
 * One task per chosen item in `projectId`, optionally tagged (label failures are non-fatal).
 * `onSaved` fires after each item is created, so a mid-batch failure still tells the caller
 * which ones landed.
 */
export async function createTasksFromItems(
  chosen: DraftItem[],
  projectId: string,
  label: string,
  onSaved?: (item: DraftItem) => void,
): Promise<void> {
  const tag = label.trim();
  for (const item of chosen) {
    const task = await createTask({ title: item.text.trim(), projectLocalId: projectId });
    if (tag && task.localId) {
      try {
        await applyLabelsByTitle(task.localId, [tag]);
      } catch (err) {
        console.warn('[shopping-photo] label apply failed:', err);
      }
    }
    onSaved?.(item);
  }
}
