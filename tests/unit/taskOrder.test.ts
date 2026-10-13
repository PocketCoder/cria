import { describe, expect, it } from 'vitest';
import type { Task } from '@/domain/task';
import { orderTasksByIds, reorderTasksByIds } from '@/lib/taskOrder';

const t = (id: string) => ({ localId: id }) as unknown as Task;
const ids = (list: Task[]) => list.map((x) => x.localId);

describe('reorderTasksByIds', () => {
  it('puts ordered ids first and keeps the rest in place', () => {
    expect(ids(reorderTasksByIds([t('a'), t('b'), t('c'), t('d')], ['c', 'a']))).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });
});

describe('orderTasksByIds', () => {
  it('follows the id order, skips unknown ids and appends unseen tasks', () => {
    expect(ids(orderTasksByIds([t('a'), t('b'), t('c')], ['c', 'zzz', 'a']))).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});
