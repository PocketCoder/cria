import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTask = vi.fn();
const applyLabelsByTitle = vi.fn();
vi.mock('@/db/tasks', () => ({ createTask: (...a: unknown[]) => createTask(...a) }));
vi.mock('@/db/labels', () => ({
  applyLabelsByTitle: (...a: unknown[]) => applyLabelsByTitle(...a),
}));

import {
  addButtonLabel,
  createTasksFromItems,
  removeItem,
  selectedItems,
  selectedLabel,
  setItemIncluded,
  setItemText,
  type DraftItem,
} from '@/features/shoppingPhoto/photoItems';

const items: DraftItem[] = [
  { id: 1, text: 'milk', include: true },
  { id: 2, text: '   ', include: true },
  { id: 3, text: 'eggs', include: false },
];

describe('draft item helpers', () => {
  it('selects included, non-blank items', () => {
    expect(selectedItems(items).map((i) => i.id)).toEqual([1]);
  });
  it('updates one item immutably', () => {
    expect(setItemIncluded(items, 3, true)[2]!.include).toBe(true);
    expect(setItemText(items, 1, 'oat milk')[0]!.text).toBe('oat milk');
    expect(items[0]!.text).toBe('milk');
  });
  it('removes by id', () => {
    expect(removeItem(items, 2).map((i) => i.id)).toEqual([1, 3]);
  });
  it('pluralises labels', () => {
    expect(selectedLabel(1)).toBe('1 item selected');
    expect(selectedLabel(2)).toBe('2 items selected');
    expect(addButtonLabel(1)).toBe('Add 1 task');
    expect(addButtonLabel(0)).toBe('Add 0 tasks');
  });
});

describe('createTasksFromItems', () => {
  beforeEach(() => {
    createTask.mockReset().mockResolvedValue({ localId: 't' });
    applyLabelsByTitle.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('creates a trimmed task per item and tags it', async () => {
    await createTasksFromItems([{ id: 1, text: ' milk ', include: true }], 'p1', ' shop ');
    expect(createTask).toHaveBeenCalledWith({ title: 'milk', projectLocalId: 'p1' });
    expect(applyLabelsByTitle).toHaveBeenCalledWith('t', ['shop']);
  });

  it('skips the label when blank and tolerates label failures', async () => {
    await createTasksFromItems([{ id: 1, text: 'a', include: true }], 'p1', ' ');
    expect(applyLabelsByTitle).not.toHaveBeenCalled();
    applyLabelsByTitle.mockRejectedValue(new Error('x'));
    await expect(
      createTasksFromItems([{ id: 1, text: 'a', include: true }], 'p1', 'l'),
    ).resolves.toBeUndefined();
  });

  it('propagates task creation failures', async () => {
    createTask.mockRejectedValue(new Error('boom'));
    await expect(
      createTasksFromItems([{ id: 1, text: 'a', include: true }], 'p1', ''),
    ).rejects.toThrow('boom');
  });
});
