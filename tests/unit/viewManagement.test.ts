// Pure helpers behind the view manager (src/lib/viewManagement.ts): the
// last-view / placeholder delete guard, the post-delete fallback, and drag
// reorder planning on top of the shared fractional-position helper.

import { describe, it, expect } from 'vitest';
import {
  canReorderViews,
  newViewTitle,
  planViewReorder,
  viewAfterDelete,
  viewDeleteBlocker,
  viewLabel,
} from '@/lib/viewManagement';

type V = { localId: string; position: number | null; placeholder: boolean };

const v = (localId: string, position: number | null, placeholder = false): V => ({
  localId,
  position,
  placeholder,
});

describe('viewLabel / newViewTitle', () => {
  it('prefers the title and falls back to the kind label', () => {
    expect(viewLabel({ title: 'Sprint', viewKind: 'kanban' })).toBe('Sprint');
    expect(viewLabel({ title: '', viewKind: 'kanban' })).toBe('Board');
  });

  it('trims a typed title and defaults a blank one to the kind label', () => {
    expect(newViewTitle('  Roadmap ', 'gantt')).toBe('Roadmap');
    expect(newViewTitle('   ', 'table')).toBe('Table');
  });
});

describe('viewDeleteBlocker', () => {
  it('blocks deleting the only view', () => {
    expect(viewDeleteBlocker([v('a', 100)], 'a')).toBe('last-view');
  });

  it('blocks deleting a local placeholder', () => {
    expect(viewDeleteBlocker([v('a', 0, true), v('b', 1, true)], 'a')).toBe('placeholder');
  });

  it('reports last-view before placeholder when both apply', () => {
    expect(viewDeleteBlocker([v('a', 0, true)], 'a')).toBe('last-view');
  });

  it('allows deleting a synced view while another remains', () => {
    expect(viewDeleteBlocker([v('a', 100), v('b', 200)], 'b')).toBeNull();
  });

  it('is a no-op answer for an unknown id', () => {
    expect(viewDeleteBlocker([v('a', 100)], 'zzz')).toBeNull();
  });
});

describe('viewAfterDelete', () => {
  const views = [v('a', 100), v('b', 200), v('c', 300)];

  it('picks the view below the deleted one', () => {
    expect(viewAfterDelete(views, 'a')).toBe('b');
    expect(viewAfterDelete(views, 'b')).toBe('c');
  });

  it('falls back to the view above when the last one goes', () => {
    expect(viewAfterDelete(views, 'c')).toBe('b');
  });

  it('returns null when nothing is left or the id is unknown', () => {
    expect(viewAfterDelete([v('a', 100)], 'a')).toBeNull();
    expect(viewAfterDelete(views, 'zzz')).toBeNull();
  });
});

describe('canReorderViews', () => {
  it('needs at least two views', () => {
    expect(canReorderViews([v('a', 100)])).toBe(false);
    expect(canReorderViews([v('a', 100), v('b', 200)])).toBe(true);
  });

  it('is off while any local placeholder is present', () => {
    expect(canReorderViews([v('a', 100), v('b', 1, true)])).toBe(false);
  });
});

describe('planViewReorder', () => {
  // Vikunja's default views sit at 100/200/300/400.
  const server = [v('list', 100), v('gantt', 200), v('table', 300), v('kanban', 400)];

  it('returns null when dropped on itself or an unknown id', () => {
    expect(planViewReorder(server, 'list', 'list')).toBeNull();
    expect(planViewReorder(server, 'list', 'nope')).toBeNull();
    expect(planViewReorder(server, 'nope', 'list')).toBeNull();
  });

  it('moving down lands between the new neighbours (midpoint)', () => {
    const r = planViewReorder(server, 'list', 'table')!;
    expect(r.orderedIds).toEqual(['gantt', 'table', 'list', 'kanban']);
    expect(r.plan).toEqual({ type: 'midpoint', position: 350 });
  });

  it('moving up lands between the new neighbours (midpoint)', () => {
    const r = planViewReorder(server, 'kanban', 'gantt')!;
    expect(r.orderedIds).toEqual(['list', 'kanban', 'gantt', 'table']);
    expect(r.plan).toEqual({ type: 'midpoint', position: 150 });
  });

  it('moving to the top halves the first position', () => {
    const r = planViewReorder(server, 'table', 'list')!;
    expect(r.orderedIds).toEqual(['table', 'list', 'gantt', 'kanban']);
    expect(r.plan).toEqual({ type: 'midpoint', position: 50 });
  });

  it('moving to the bottom steps past the last position', () => {
    const r = planViewReorder(server, 'list', 'kanban')!;
    expect(r.orderedIds).toEqual(['gantt', 'table', 'kanban', 'list']);
    expect(r.plan).toEqual({ type: 'midpoint', position: 400 + 1024 });
  });

  it('re-indexes when the neighbours collide or have no position', () => {
    const zeros = [v('a', 0), v('b', 0), v('c', 0)];
    expect(planViewReorder(zeros, 'c', 'a')!.plan).toEqual({ type: 'reindex' });

    const nulls = [v('a', 100), v('b', null), v('c', 300)];
    expect(planViewReorder(nulls, 'a', 'b')!.plan).toEqual({ type: 'reindex' });
  });
});
