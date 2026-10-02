import { describe, expect, it } from 'vitest';
import { withViewTransition } from '@/lib/viewTransition';

describe('withViewTransition', () => {
  it('runs the update and afterUpdate synchronously when the API is missing', async () => {
    const calls: string[] = [];
    const done = withViewTransition('nav', () => calls.push('update'), {
      afterUpdate: () => calls.push('after'),
    });
    expect(calls).toEqual(['update', 'after']);
    await expect(done).resolves.toBeUndefined();
  });
});
