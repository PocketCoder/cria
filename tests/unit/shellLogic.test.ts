import { describe, expect, it } from 'vitest';
import {
  parseDeepLink,
  resolveInitialViewId,
  syncStatus,
  viewTitle,
} from '@/features/shell/shellLogic';

describe('viewTitle', () => {
  const projects = [{ localId: 'p1', title: 'Home' }];
  it('names each smart view', () => {
    expect(viewTitle(null, projects)).toBe('Cria');
    expect(viewTitle({ kind: 'today' }, projects)).toBe('Today');
    expect(viewTitle({ kind: 'upcoming' }, projects)).toBe('Upcoming');
    expect(viewTitle({ kind: 'inbox' }, projects)).toBe('Inbox');
    expect(viewTitle({ kind: 'favorites' }, projects)).toBe('Favorites');
    expect(viewTitle({ kind: 'search' }, projects)).toBe('Search');
    expect(viewTitle({ kind: 'browse' }, projects)).toBe('Browse');
    expect(viewTitle({ kind: 'label', localId: 'l' }, projects)).toBe('Label');
  });
  it('uses the project title, with a fallback', () => {
    expect(viewTitle({ kind: 'project', localId: 'p1' }, projects)).toBe('Home');
    expect(viewTitle({ kind: 'project', localId: 'zz' }, projects)).toBe('Project');
  });
});

describe('resolveInitialViewId', () => {
  const views = [{ localId: 'a' }, { localId: 'b' }];
  it('prefers a stored id that still exists', () => {
    expect(resolveInitialViewId('b', views)).toBe('b');
  });
  it('falls back to the first view', () => {
    expect(resolveInitialViewId(null, views)).toBe('a');
    expect(resolveInitialViewId('gone', views)).toBe('a');
  });
});

describe('parseDeepLink', () => {
  it('parses task and project links', () => {
    expect(parseDeepLink('vikunja://task/42')).toEqual({ type: 'task', serverId: 42 });
    expect(parseDeepLink('vikunja://project/7')).toEqual({ type: 'project', serverId: 7 });
  });
  it('rejects anything else', () => {
    expect(parseDeepLink('vikunja://label/1')).toBeNull();
    expect(parseDeepLink('https://example.com')).toBeNull();
  });
});

describe('syncStatus', () => {
  const ok = { isOnline: true, outboxCount: 0, deadLetterCount: 0, conflictCount: 0 };
  it('is hidden when all is well', () => {
    expect(syncStatus(ok)).toBeNull();
  });
  it('reports offline, with and without queued changes', () => {
    expect(syncStatus({ ...ok, isOnline: false })).toMatchObject({
      icon: 'offline',
      destructive: true,
      label: 'Offline',
    });
    expect(syncStatus({ ...ok, isOnline: false, outboxCount: 2 })!.label).toBe(
      'Offline — 2 saved locally',
    );
  });
  it('reports dead letters first, then sending, then conflicts', () => {
    expect(syncStatus({ ...ok, deadLetterCount: 1 })).toMatchObject({
      icon: 'alert',
      destructive: true,
      label: "1 change wouldn't send",
    });
    expect(syncStatus({ ...ok, outboxCount: 3 })).toMatchObject({
      icon: 'upload',
      destructive: false,
      label: 'Sending 3 changes…',
    });
    expect(syncStatus({ ...ok, outboxCount: 1 })!.label).toBe('Sending 1 change…');
    expect(syncStatus({ ...ok, conflictCount: 2 })).toMatchObject({
      icon: 'alert',
      onlyConflicts: true,
      label: '2 conflicts',
    });
  });
  it('sums the badge total and is not conflict-only when other work is pending', () => {
    const s = syncStatus({ ...ok, outboxCount: 1, deadLetterCount: 2, conflictCount: 3 })!;
    expect(s.total).toBe(6);
    expect(s.onlyConflicts).toBe(false);
  });
});

import { resolveCurrentProjectView, showMobileFab } from '@/features/shell/shellLogic';

describe('resolveCurrentProjectView', () => {
  const projects = [{ localId: 'p1' }];
  const views = [{ localId: 'v1' }, { localId: 'v2' }];
  it('is empty outside a project', () => {
    expect(resolveCurrentProjectView({ kind: 'today' }, projects, views)).toEqual({
      project: undefined,
      view: undefined,
    });
    expect(resolveCurrentProjectView(null, projects, views).project).toBeUndefined();
  });
  it('defaults to the first view', () => {
    const r = resolveCurrentProjectView({ kind: 'project', localId: 'p1' }, projects, views);
    expect(r.project).toBe(projects[0]);
    expect(r.view).toBe(views[0]);
  });
  it('honours an explicit view and tolerates unknown ones', () => {
    expect(
      resolveCurrentProjectView({ kind: 'project', localId: 'p1', viewLocalId: 'v2' }, projects, views).view,
    ).toBe(views[1]);
    expect(
      resolveCurrentProjectView({ kind: 'project', localId: 'zz', viewLocalId: 'nope' }, projects, views),
    ).toEqual({ project: undefined, view: undefined });
    expect(
      resolveCurrentProjectView({ kind: 'project', localId: 'p1' }, projects, []).view,
    ).toBeUndefined();
  });
});

describe('showMobileFab', () => {
  const base = {
    isMobile: true,
    hasSelectedTask: false,
    mobileSearchOpen: false,
    photoCaptureOpen: false,
    quickAddOpen: false,
  };
  it('shows only on mobile with no overlay open', () => {
    expect(showMobileFab(base)).toBe(true);
    expect(showMobileFab({ ...base, isMobile: false })).toBe(false);
    expect(showMobileFab({ ...base, hasSelectedTask: true })).toBe(false);
    expect(showMobileFab({ ...base, mobileSearchOpen: true })).toBe(false);
    expect(showMobileFab({ ...base, photoCaptureOpen: true })).toBe(false);
    expect(showMobileFab({ ...base, quickAddOpen: true })).toBe(false);
  });
});
