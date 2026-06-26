import { describe, it, expect } from 'vitest';
import {
  applyDisplay,
  defaultConfigFor,
  type DisplayConfig,
  type DisplayCtx,
} from '@/lib/displayConfig';
import type { TaskWithProject } from '@/db/tasks';

const TODAY = new Date(2026, 5, 25); // 2026-06-25 (matches reference screenshots)

function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d, 12)).toISOString();
}

function task(over: Partial<TaskWithProject>): TaskWithProject {
  return {
    localId: over.localId ?? Math.random().toString(36).slice(2),
    serverId: null,
    projectLocalId: 'p1',
    projectTitle: over.projectTitle ?? 'Work',
    title: over.title ?? 'Task',
    description: null,
    done: false,
    doneAt: null,
    dueDate: null,
    startDate: null,
    endDate: null,
    priority: 0,
    percentDone: 0,
    hexColor: null,
    position: null,
    isFavorite: false,
    isSubscribed: false,
    repeatAfter: 0,
    repeatMode: 0,
    updatedAt: iso(2026, 6, 1),
    createdAt: iso(2026, 6, 1),
    createdById: null,
    identifier: null,
    ...over,
  };
}

const ctx: DisplayCtx = {
  labelsByTask: new Map([['t-label', ['l1']]]),
  labelTitleById: new Map([['l1', 'Errands']]),
  assigneesByTask: new Map([['t-me', [7]]]),
  currentUserId: 7,
  today: TODAY,
};

function cfg(over: Partial<DisplayConfig>): DisplayConfig {
  return { ...defaultConfigFor('inbox'), ...over };
}

describe('applyDisplay', () => {
  it('hides completed tasks by default but still counts them', () => {
    const tasks = [task({ title: 'a' }), task({ title: 'b', done: true })];
    const r = applyDisplay(tasks, ctx, cfg({}));
    expect(r.completedCount).toBe(1);
    expect(r.groups.flatMap((g) => g.tasks)).toHaveLength(1);
  });

  it('shows completed tasks when toggled on', () => {
    const tasks = [task({ title: 'a' }), task({ title: 'b', done: true })];
    const r = applyDisplay(tasks, ctx, cfg({ showCompleted: true }));
    expect(r.groups.flatMap((g) => g.tasks)).toHaveLength(2);
  });

  it('filters by priority set', () => {
    const tasks = [task({ priority: 5, title: 'hi' }), task({ priority: 0, title: 'lo' })];
    const r = applyDisplay(tasks, ctx, cfg({ filters: { priority: [5] } }));
    const titles = r.groups.flatMap((g) => g.tasks).map((t) => t.title);
    expect(titles).toEqual(['hi']);
  });

  it('filters by due-date window (overdue / today / week / none)', () => {
    const tasks = [
      task({ title: 'past', dueDate: iso(2026, 6, 20) }),
      task({ title: 'now', dueDate: iso(2026, 6, 25) }),
      task({ title: 'soon', dueDate: iso(2026, 6, 28) }),
      task({ title: 'nodate' }),
    ];
    const pick = (f: 'overdue' | 'today' | 'week' | 'none') =>
      applyDisplay(tasks, ctx, cfg({ filters: { dueDate: f } }))
        .groups.flatMap((g) => g.tasks)
        .map((t) => t.title);
    expect(pick('overdue')).toEqual(['past']);
    expect(pick('today')).toEqual(['now']);
    expect(pick('week').sort()).toEqual(['now', 'soon']);
    expect(pick('none')).toEqual(['nodate']);
  });

  it('filters deadline against endDate', () => {
    const tasks = [
      task({ title: 'dl-today', endDate: iso(2026, 6, 25) }),
      task({ title: 'dl-none' }),
    ];
    const r = applyDisplay(tasks, ctx, cfg({ filters: { deadline: 'today' } }));
    expect(r.groups.flatMap((g) => g.tasks).map((t) => t.title)).toEqual(['dl-today']);
  });

  it('filters by label title and assignee=me', () => {
    const tasks = [
      task({ localId: 't-label', title: 'errand' }),
      task({ localId: 't-me', title: 'mine' }),
      task({ localId: 't-other', title: 'other' }),
    ];
    expect(
      applyDisplay(tasks, ctx, cfg({ filters: { labels: ['Errands'] } }))
        .groups.flatMap((g) => g.tasks)
        .map((t) => t.title),
    ).toEqual(['errand']);
    expect(
      applyDisplay(tasks, ctx, cfg({ filters: { assignee: 'me' } }))
        .groups.flatMap((g) => g.tasks)
        .map((t) => t.title),
    ).toEqual(['mine']);
    expect(
      applyDisplay(tasks, ctx, cfg({ filters: { assignee: 'unassigned' } }))
        .groups.flatMap((g) => g.tasks)
        .map((t) => t.title)
        .sort(),
    ).toEqual(['errand', 'other']);
  });

  it('groups by project', () => {
    const tasks = [
      task({ title: 'a', projectTitle: 'Work' }),
      task({ title: 'b', projectTitle: 'Home' }),
      task({ title: 'c', projectTitle: 'Work' }),
    ];
    const r = applyDisplay(tasks, ctx, cfg({ groupBy: 'project' }));
    const work = r.groups.find((g) => g.label === 'Work');
    expect(work?.tasks.map((t) => t.title).sort()).toEqual(['a', 'c']);
  });

  it('groups by dueDate with Overdue/Today/Tomorrow ordered first', () => {
    const tasks = [
      task({ title: 'later', dueDate: iso(2026, 7, 10) }),
      task({ title: 'od', dueDate: iso(2026, 6, 1) }),
      task({ title: 'tm', dueDate: iso(2026, 6, 26) }),
      task({ title: 'td', dueDate: iso(2026, 6, 25) }),
    ];
    const r = applyDisplay(tasks, ctx, cfg({ groupBy: 'dueDate' }));
    expect(r.groups.map((g) => g.label)).toEqual([
      'Overdue',
      'Today',
      'Tomorrow',
      'Friday 10 Jul',
    ]);
  });

  it('smart-sorts by due date then priority', () => {
    const tasks = [
      task({ title: 'nodate', priority: 5 }),
      task({ title: 'soon-lo', dueDate: iso(2026, 6, 26), priority: 1 }),
      task({ title: 'soon-hi', dueDate: iso(2026, 6, 26), priority: 5 }),
      task({ title: 'now', dueDate: iso(2026, 6, 25) }),
    ];
    const r = applyDisplay(tasks, ctx, cfg({ sort: { field: 'smart', direction: 'asc' } }));
    expect(r.groups.flatMap((g) => g.tasks).map((t) => t.title)).toEqual([
      'now',
      'soon-hi',
      'soon-lo',
      'nodate',
    ]);
  });
});
