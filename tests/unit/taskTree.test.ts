import { describe, expect, it } from 'vitest';
import type { Task } from '@/domain/task';
import {
  buildTaskTree,
  collectSubtreeIds,
  flattenTreeIds,
  orderRoots,
  resolveRootTargetId,
} from '@/features/tasks/taskTree';

const t = (id: string) => ({ localId: id }) as unknown as Task;

describe('buildTaskTree', () => {
  it('nests children under visible parents', () => {
    const tree = buildTaskTree([t('a'), t('b'), t('c')], new Map([['a', ['b']]]));
    expect(tree.map((n) => n.task.localId)).toEqual(['a', 'c']);
    expect(tree[0]!.children.map((n) => n.task.localId)).toEqual(['b']);
  });

  it('keeps a child as a root when its parent is not visible', () => {
    const tree = buildTaskTree([t('b')], new Map([['a', ['b']]]));
    expect(tree.map((n) => n.task.localId)).toEqual(['b']);
  });

  it('skips relation children that are not in the visible set', () => {
    const tree = buildTaskTree([t('a')], new Map([['a', ['ghost']]]));
    expect(tree[0]!.children).toEqual([]);
  });
});

describe('tree helpers', () => {
  const tree = buildTaskTree(
    [t('a'), t('b'), t('c'), t('d')],
    new Map([
      ['a', ['b']],
      ['b', ['c']],
    ]),
  );

  it('flattens depth first', () => {
    expect(flattenTreeIds(tree)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('collects a node and its descendants', () => {
    expect(collectSubtreeIds('a', tree)).toEqual(['a', 'b', 'c']);
    expect(collectSubtreeIds('missing', tree)).toEqual([]);
  });

  it('resolves a nested drop target to its root', () => {
    expect(resolveRootTargetId('c', tree)).toBe('a');
    expect(resolveRootTargetId('d', tree)).toBe('d');
    expect(resolveRootTargetId('unknown', tree)).toBe('unknown');
  });

  it('orders roots by id list and appends unseen roots', () => {
    expect(orderRoots(tree, ['d', 'a']).map((n) => n.task.localId)).toEqual(['d', 'a']);
    const withNew = buildTaskTree([t('a'), t('d'), t('n')], new Map());
    expect(orderRoots(withNew, ['d', 'zzz', 'a']).map((n) => n.task.localId)).toEqual([
      'd',
      'a',
      'n',
    ]);
  });
});
