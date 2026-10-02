import { describe, expect, it, vi } from 'vitest';
import { buildPaletteActions, type PaletteAction } from '@/components/paletteActions';
import {
  filterPaletteActions,
  groupPaletteActions,
  paletteRightLabel,
} from '@/lib/paletteFilter';
import { useUi } from '@/stores/ui';

function deps() {
  return {
    projects: [{ localId: 'p1', title: 'Home' }],
    labels: [{ localId: 'l1', title: 'Errand' }],
    tasks: [
      {
        localId: 't1',
        title: 'Buy milk',
        projectTitle: 'Home',
        projectLocalId: 'p1',
        priority: 4,
        dueDate: '2030-01-01T00:00:00Z',
      },
    ],
    setActiveView: vi.fn(),
    setSelectedProject: vi.fn(),
    onClose: vi.fn(),
    onOpenQuickAdd: vi.fn(),
    onOpenSettings: vi.fn(),
    aiAvailable: false,
  };
}

describe('buildPaletteActions', () => {
  it('lists views, projects, labels, tasks then actions in order', () => {
    const ids = buildPaletteActions(deps()).map((a) => a.id);
    expect(ids).toEqual([
      'view-today',
      'view-upcoming',
      'view-inbox',
      'view-favorites',
      'project-p1',
      'label-l1',
      'task-t1',
      'action-quick-add',
      'action-settings',
    ]);
  });

  it('adds the Ramble action only when AI is available', () => {
    const ids = buildPaletteActions({ ...deps(), aiAvailable: true }).map((a) => a.id);
    expect(ids).toContain('action-ramble');
    expect(ids.indexOf('action-ramble')).toBeLessThan(ids.indexOf('action-settings'));
  });

  it('wires selection handlers and closes the palette', () => {
    const d = deps();
    const byId = Object.fromEntries(buildPaletteActions(d).map((a) => [a.id, a]));

    byId['view-inbox']!.onSelect();
    expect(d.setActiveView).toHaveBeenCalledWith({ kind: 'inbox' });

    byId['project-p1']!.onSelect();
    expect(d.setSelectedProject).toHaveBeenCalledWith('p1');

    byId['label-l1']!.onSelect();
    expect(d.setActiveView).toHaveBeenCalledWith({ kind: 'label', localId: 'l1' });

    byId['action-quick-add']!.onSelect();
    expect(d.onOpenQuickAdd).toHaveBeenCalled();
    byId['action-settings']!.onSelect();
    expect(d.onOpenSettings).toHaveBeenCalled();
    expect(d.onClose).toHaveBeenCalledTimes(5);
  });

  it('opens a task in its project with the task selected', () => {
    const d = deps();
    const task = buildPaletteActions(d).find((a) => a.id === 'task-t1')!;
    task.onSelect();
    expect(useUi.getState().activeView).toEqual({ kind: 'project', localId: 'p1' });
    expect(useUi.getState().selectedTaskLocalId).toBe('t1');
    expect(task.taskLocalId).toBe('t1');
    expect(task.priority).toBe(4);
  });
});

describe('palette filtering and grouping', () => {
  const actions = buildPaletteActions(deps());

  it('keeps everything for an empty query', () => {
    expect(filterPaletteActions(actions, '  ')).toBe(actions);
  });

  it('matches label, keywords and subtitle case-insensitively', () => {
    expect(filterPaletteActions(actions, 'MILK').map((a) => a.id)).toEqual(['task-t1']);
    expect(filterPaletteActions(actions, 'starred').map((a) => a.id)).toEqual(['view-favorites']);
    expect(filterPaletteActions(actions, 'project').map((a) => a.id)).toContain('project-p1');
  });

  it('groups in the fixed order and drops empty groups', () => {
    const grouped = groupPaletteActions(actions);
    expect(grouped.map((g) => g.name)).toEqual(['Views', 'Projects', 'Labels', 'Tasks', 'Actions']);
    const onlyActions = groupPaletteActions(actions.filter((a) => a.group === 'Actions'));
    expect(onlyActions.map((g) => g.name)).toEqual(['Actions']);
  });

  it('builds the right-hand label', () => {
    const fmt = (iso: string) => `due:${iso.slice(0, 4)}`;
    const task = actions.find((a) => a.id === 'task-t1') as PaletteAction;
    expect(paletteRightLabel(task, fmt)).toBe('Home · due:2030');
    expect(paletteRightLabel({ ...task, dueDate: null }, fmt)).toBe('Home');
    const view = actions.find((a) => a.id === 'view-today') as PaletteAction;
    expect(paletteRightLabel(view, fmt)).toBe('View');
  });
});
