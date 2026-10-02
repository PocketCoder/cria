import { afterEach, describe, expect, it, vi } from 'vitest';
import { withViewTransition } from '@/lib/viewTransition';

/**
 * Stubs just enough of the DOM for the animated path. Each
 * `startViewTransition` call returns a transition whose `finished` the test
 * settles by hand, standing in for the browser skipping or completing it.
 */
function stubViewTransitions() {
  const dataset: Record<string, string | undefined> = {};
  const finishers: Array<() => void> = [];
  vi.stubGlobal('document', {
    documentElement: { dataset },
    startViewTransition: () => ({
      finished: new Promise<void>((resolve) => finishers.push(resolve)),
    }),
  });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  return { dataset, finish: (i: number) => finishers[i]?.() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withViewTransition', () => {
  it('runs the update and afterUpdate synchronously when the API is missing', async () => {
    const calls: string[] = [];
    const done = withViewTransition('nav', () => calls.push('update'), {
      afterUpdate: () => calls.push('after'),
    });
    expect(calls).toEqual(['update', 'after']);
    await expect(done).resolves.toBeUndefined();
  });

  it('sets the marker for the transition and clears it once finished', async () => {
    const { dataset, finish } = stubViewTransitions();
    const done = withViewTransition('theme', () => {});
    expect(dataset.vt).toBe('theme');
    finish(0);
    await done;
    expect(dataset.vt).toBeUndefined();
  });

  it('keeps the marker when a second transition of the same kind replaces the first', async () => {
    const { dataset, finish } = stubViewTransitions();
    const first = withViewTransition('theme', () => {});
    const second = withViewTransition('theme', () => {});
    // The browser skips the first transition, so it settles before the second.
    finish(0);
    await first;
    expect(dataset.vt).toBe('theme');
    finish(1);
    await second;
    expect(dataset.vt).toBeUndefined();
  });

  it('keeps the marker when a transition of a different kind replaces the first', async () => {
    const { dataset, finish } = stubViewTransitions();
    const first = withViewTransition('nav', () => {});
    const second = withViewTransition('task', () => {});
    finish(0);
    await first;
    expect(dataset.vt).toBe('task');
    finish(1);
    await second;
    expect(dataset.vt).toBeUndefined();
  });
});
