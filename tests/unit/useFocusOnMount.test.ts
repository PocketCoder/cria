import { describe, expect, it, vi } from 'vitest';

// Run the hook outside a component: useCallback just returns its callback.
vi.mock('react', () => ({ useCallback: <T>(fn: T) => fn }));

import { useFocusOnMount } from '@/lib/useFocusOnMount';

describe('useFocusOnMount', () => {
  it('focuses the element it is attached to and ignores null', () => {
    const ref = useFocusOnMount<HTMLInputElement>();
    const el = { focus: vi.fn() } as unknown as HTMLInputElement;
    ref(el);
    ref(null);
    expect(el.focus).toHaveBeenCalledTimes(1);
  });
});
