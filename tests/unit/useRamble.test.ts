// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { generate, createFromQuickAdd } = vi.hoisted(() => ({
  generate: vi.fn(),
  createFromQuickAdd: vi.fn(),
}));
vi.mock('@/tauri/ai', () => ({ generate }));
vi.mock('@/queries/projects', () => ({
  useSelectableProjects: () => ({ data: [{ localId: 'p1', title: 'Inbox' }] }),
}));
vi.mock('@/queries/labels', () => ({ useLabels: () => ({ data: [] }) }));
vi.mock('@/features/ramble/createFromQuickAdd', () => ({ createFromQuickAdd }));

import { useRamble } from '@/features/ramble/useRamble';
import { useUi } from '@/stores/ui';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useRamble', () => {
  beforeEach(() => {
    generate.mockReset();
    createFromQuickAdd.mockReset();
    useUi.setState({ rambleDraft: 'call mum and buy milk', rambleLines: null, activeView: null });
  });

  it('ignores Organise while a save is in flight', async () => {
    generate.mockResolvedValue('Call mum\nBuy milk');
    const save = deferred<void>();
    createFromQuickAdd.mockReturnValue(save.promise);
    const { result } = renderHook(() => useRamble(() => {}));
    await act(() => result.current.organise());
    expect(result.current.phase).toBe('review');

    let adding!: Promise<void>;
    act(() => {
      adding = result.current.addAll();
    });
    expect(result.current.phase).toBe('saving');

    generate.mockClear();
    await act(() => result.current.organise());
    expect(generate).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('saving');

    save.resolve();
    await act(() => adding);
  });

  it('keeps a result that lands after close for the next open', async () => {
    const out = deferred<string>();
    generate.mockReturnValue(out.promise);
    const first = renderHook(() => useRamble(() => {}));
    let organising!: Promise<void>;
    act(() => {
      organising = first.result.current.organise();
    });
    expect(first.result.current.phase).toBe('thinking');

    first.unmount();
    out.resolve('Call mum\nBuy milk');
    await organising;
    expect(useUi.getState().rambleLines).toEqual(['Call mum', 'Buy milk']);

    const second = renderHook(() => useRamble(() => {}));
    expect(second.result.current.phase).toBe('review');
    expect(second.result.current.drafts.map((d) => d.line)).toEqual(['Call mum', 'Buy milk']);
    expect(useUi.getState().rambleLines).toBeNull();
  });

  it('keeps nothing when the model fails after close', async () => {
    const out = deferred<string>();
    generate.mockReturnValue(out.promise);
    const { result, unmount } = renderHook(() => useRamble(() => {}));
    let organising!: Promise<void>;
    act(() => {
      organising = result.current.organise();
    });
    unmount();
    out.reject(new Error('model failed'));
    await organising;
    expect(useUi.getState().rambleLines).toBeNull();
  });
});
