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

  describe('closing while saving', () => {
    async function startSave(onClose: () => void) {
      generate.mockResolvedValue('Call mum\nBuy milk');
      const view = renderHook(() => useRamble(onClose));
      await act(() => view.result.current.organise());
      return view;
    }

    it('ignores close until the save finishes', async () => {
      const onClose = vi.fn();
      const save = deferred<void>();
      createFromQuickAdd.mockReturnValue(save.promise);
      const { result } = await startSave(onClose);

      let adding!: Promise<void>;
      act(() => {
        adding = result.current.addAll();
      });
      act(() => result.current.close());
      expect(onClose).not.toHaveBeenCalled();

      save.resolve();
      await act(() => adding);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes normally when not saving', async () => {
      const onClose = vi.fn();
      const { result } = await startSave(onClose);
      act(() => result.current.close());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close or wipe a reopened sheet when a save finishes after unmount', async () => {
      const onClose = vi.fn();
      const save = deferred<void>();
      createFromQuickAdd.mockReturnValue(save.promise);
      const first = await startSave(onClose);
      let adding!: Promise<void>;
      act(() => {
        adding = first.result.current.addAll();
      });

      first.unmount();
      useUi.setState({ rambleDraft: 'something new', rambleLines: ['Pending line'] });
      save.resolve();
      await adding;

      expect(onClose).not.toHaveBeenCalled();
      expect(useUi.getState().rambleDraft).toBe('something new');
      expect(useUi.getState().rambleLines).toEqual(['Pending line']);
    });

    it('clears the saved draft text when a save finishes after unmount', async () => {
      const save = deferred<void>();
      createFromQuickAdd.mockReturnValue(save.promise);
      const first = await startSave(() => {});
      let adding!: Promise<void>;
      act(() => {
        adding = first.result.current.addAll();
      });
      first.unmount();
      save.resolve();
      await adding;
      expect(useUi.getState().rambleDraft).toBe('');
    });

    it('keeps only the unsaved lines for the next open when a save fails after unmount', async () => {
      const onClose = vi.fn();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      createFromQuickAdd.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
      const first = await startSave(onClose);
      let adding!: Promise<void>;
      act(() => {
        adding = first.result.current.addAll();
      });
      first.unmount();
      await adding;
      errorSpy.mockRestore();

      expect(onClose).not.toHaveBeenCalled();
      expect(useUi.getState().rambleLines).toEqual(['Buy milk']);
    });
  });
});
