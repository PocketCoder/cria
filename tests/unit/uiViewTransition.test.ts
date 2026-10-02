// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Defer the commit like a real View Transition does (applies a frame later).
const pending: (() => void)[] = [];
vi.mock('@/lib/viewTransition', () => ({
  canAnimate: () => false,
  withViewTransition: (_kind: string, update: () => void) => {
    pending.push(update);
    return Promise.resolve();
  },
}));

import { useUi } from '@/stores/ui';

const flush = () => pending.splice(0).forEach((fn) => fn());

beforeEach(() => {
  pending.length = 0;
  useUi.setState({ activeView: { kind: 'today' }, selectedTaskLocalId: null });
});

describe('setActiveView with a deferred commit', () => {
  it('keeps a task selected after the view call', () => {
    const ui = useUi.getState();
    ui.setActiveView({ kind: 'project', localId: 'p1' });
    ui.setSelectedTask('t1');
    flush();
    expect(useUi.getState().activeView).toEqual({ kind: 'project', localId: 'p1' });
    expect(useUi.getState().selectedTaskLocalId).toBe('t1');
  });

  it('keeps the task when it is already the selected one', () => {
    useUi.setState({ selectedTaskLocalId: 't1' });
    const ui = useUi.getState();
    ui.setActiveView({ kind: 'project', localId: 'p1' });
    ui.setSelectedTask('t1');
    flush();
    expect(useUi.getState().selectedTaskLocalId).toBe('t1');
  });

  it('still clears the selection when nothing selects afterwards', () => {
    useUi.setState({ selectedTaskLocalId: 't1' });
    useUi.getState().setActiveView({ kind: 'inbox' });
    flush();
    expect(useUi.getState().selectedTaskLocalId).toBeNull();
  });
});
