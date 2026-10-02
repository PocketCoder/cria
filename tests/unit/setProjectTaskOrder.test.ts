import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Task } from '@/domain/task';
import { setProjectTaskOrder } from '@/queries/tasks';

const t = (id: string) => ({ localId: id }) as unknown as Task;
const ids = (list: Task[] | undefined) => list?.map((x) => x.localId);

describe('setProjectTaskOrder', () => {
  it('reorders the cache entries useProjectTasks actually reads', () => {
    const qc = new QueryClient();
    // Same shape as useProjectTasks: ['tasks', project, filter, sortRule, includeNulls].
    const key = ['tasks', 'p1', undefined, undefined, false] as const;
    const filtered = ['tasks', 'p1', 'done = false', undefined, true] as const;
    qc.setQueryData(key, [t('a'), t('b'), t('c')]);
    qc.setQueryData(filtered, [t('a'), t('b')]);

    setProjectTaskOrder(qc, 'p1', ['c', 'a', 'b']);

    expect(ids(qc.getQueryData(key))).toEqual(['c', 'a', 'b']);
    expect(ids(qc.getQueryData(filtered))).toEqual(['a', 'b']);
  });

  it('leaves other projects and uncached keys alone', () => {
    const qc = new QueryClient();
    const other = ['tasks', 'p2', undefined, undefined, false] as const;
    qc.setQueryData(other, [t('a'), t('b')]);

    setProjectTaskOrder(qc, 'p1', ['b', 'a']);

    expect(ids(qc.getQueryData(other))).toEqual(['a', 'b']);
    expect(qc.getQueryData(['tasks', 'p1'])).toBeUndefined();
  });
});
