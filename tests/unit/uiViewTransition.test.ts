// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Call {
  update: () => void;
  opts?: { afterUpdate?: () => void };
  finish: () => void;
  finished: Promise<void>;
}

const mock = vi.hoisted(() => ({ animate: false }));

// Defer the commit like a real View Transition does (applies a frame later).
const pending: (() => void)[] = [];
// Animated calls, kept so a test can run the update and end the animation by hand.
const calls: Call[] = [];
vi.mock('@/lib/viewTransition', () => ({
  canAnimate: () => mock.animate,
  withViewTransition: (_kind: string, update: () => void, opts?: Call['opts']) => {
    pending.push(update);
    let finish = () => {};
    const finished = new Promise<void>((r) => (finish = r));
    calls.push({ update, opts, finish, finished });
    return finished;
  },
}));

import { useUi } from '@/stores/ui';

const flush = () => pending.splice(0).forEach((fn) => fn());
const call = (i: number): Call => {
  const c = calls[i];
  if (!c) throw new Error(`no animated transition #${i}`);
  return c;
};

beforeEach(() => {
  pending.length = 0;
  calls.length = 0;
  mock.animate = false;
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

describe('task-title view-transition name', () => {
  const NAME = 'task-title';
  let a: HTMLElement;
  let b: HTMLElement;

  beforeEach(() => {
    mock.animate = true;
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    if (!globalThis.CSS?.escape) vi.stubGlobal('CSS', { escape: (s: string) => s });
    document.body.innerHTML = ['A', 'B']
      .map((id) => `<div data-task-row="${id}"><span class="task-strike"></span></div>`)
      .join('');
    a = document.querySelector<HTMLElement>('[data-task-row="A"] .task-strike')!;
    b = document.querySelector<HTMLElement>('[data-task-row="B"] .task-strike')!;
    useUi.setState({ selectedTaskLocalId: 'A' });
  });

  const named = () => [a, b].filter((el) => el.style.viewTransitionName === NAME);

  it('never lets two rows share the name when B opens before A finishes closing', async () => {
    useUi.getState().setSelectedTask(null);
    call(0).update();
    call(0).opts!.afterUpdate!();
    expect(named()).toEqual([a]);

    // A's close animation is still running; its cleanup hasn't happened yet.
    useUi.getState().setSelectedTask('B');
    expect(named()).toEqual([b]);

    // A's late cleanup must not strip B's name.
    call(0).finish();
    await call(0).finished;
    await Promise.resolve();
    expect(named()).toEqual([b]);

    // B's own cleanup, once the inspector has rendered, clears it.
    call(1).opts!.afterUpdate!();
    expect(named()).toEqual([]);
  });

  it('keeps the name on a row reopened before its own close cleanup runs', async () => {
    useUi.getState().setSelectedTask(null);
    call(0).update();
    call(0).opts!.afterUpdate!();

    useUi.getState().setSelectedTask('A');
    expect(named()).toEqual([a]);

    call(0).finish();
    await call(0).finished;
    await Promise.resolve();
    expect(named()).toEqual([a]);
  });
});
