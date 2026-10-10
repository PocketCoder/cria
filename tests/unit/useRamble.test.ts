// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const { generate, createFromQuickAdd, speech } = vi.hoisted(() => ({
  generate: vi.fn(),
  createFromQuickAdd: vi.fn(),
  speech: {
    handlers: null as null | {
      onInterim: (t: string) => void;
      onFinal: (t: string) => void;
      onEnd: (e?: string) => void;
    },
  },
}));
vi.mock('@/tauri/ai', () => ({ generate }));
vi.mock('@/tauri/speech', () => ({
  speechErrorMessage: (c: string) => `speech: ${c}`,
  startSpeech: vi.fn(async (h) => {
    speech.handlers = h;
    return { stop: () => h.onEnd() };
  }),
}));
vi.mock('@/queries/projects', () => ({
  useSelectableProjects: () => ({ data: [{ localId: 'p1', title: 'Inbox' }] }),
}));
vi.mock('@/queries/labels', () => ({ useLabels: () => ({ data: [] }) }));
vi.mock('@/features/ramble/createFromQuickAdd', () => ({ createFromQuickAdd }));

import { useRamble } from '@/features/ramble/useRamble';
import { useUi } from '@/stores/ui';
import { startSpeech } from '@/tauri/speech';
import { StrictMode } from 'react';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Open the sheet (it starts listening on its own) and wait for the mic. */
async function open(onClose: () => void = () => {}) {
  const view = renderHook(() => useRamble(onClose));
  await act(async () => {});
  return view;
}

/** Say one finished phrase and let the batch flush. */
async function say(text: string) {
  await act(async () => {
    speech.handlers!.onFinal(text);
    await vi.advanceTimersByTimeAsync(700);
  });
}

describe('useRamble (voice only)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    generate.mockReset();
    createFromQuickAdd.mockReset();
    speech.handlers = null;
    useUi.setState({ rambleLines: null, activeView: null });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('starts listening when the sheet opens', async () => {
    const { result } = await open();
    expect(result.current.listening).toBe(true);
  });

  it('turns a spoken phrase into rows, keeping a suggestion off the line', async () => {
    generate.mockResolvedValue('Call mum\nEmail landlord ~ +Flat');
    const { result } = await open();
    await say('call mum and email the landlord');
    expect(result.current.drafts.map((d) => d.line)).toEqual(['Call mum', 'Email landlord']);
    expect(result.current.drafts[1]!.suggestion).toBe('+Flat');
    expect(result.current.organising).toBe(false);
  });

  it('keeps the spoken phrase as a row when the model fails', async () => {
    generate.mockRejectedValue(new Error('unavailable'));
    const { result } = await open();
    await say('buy milk tomorrow');
    expect(result.current.drafts.map((d) => d.line)).toEqual(['buy milk tomorrow']);
  });

  it('will not add while speech is still being turned into rows', async () => {
    const out = deferred<string>();
    generate.mockReturnValue(out.promise);
    createFromQuickAdd.mockResolvedValue(undefined);
    const { result } = await open();
    await say('call mum');
    expect(result.current.organising).toBe(true);
    await act(() => result.current.addAll());
    expect(createFromQuickAdd).not.toHaveBeenCalled();
    await act(async () => out.resolve('Call mum'));
    await act(() => result.current.addAll());
    expect(createFromQuickAdd).toHaveBeenCalledTimes(1);
  });

  it('adds rows one at a time and drops the added row', async () => {
    generate.mockResolvedValue('Call mum\nBuy milk');
    createFromQuickAdd.mockResolvedValue(undefined);
    const { result } = await open();
    await say('x');
    const first = result.current.drafts[0]!;
    await act(() => result.current.addOne(first.id));
    expect(createFromQuickAdd).toHaveBeenCalledWith('Call mum', expect.objectContaining({ fallbackProjectId: 'p1' }));
    expect(result.current.drafts.map((d) => d.line)).toEqual(['Buy milk']);
  });

  it('never applies a suggestion that was not accepted', async () => {
    generate.mockResolvedValue('Email landlord ~ +Inbox');
    createFromQuickAdd.mockResolvedValue(undefined);
    const { result } = await open();
    await say('x');
    await act(() => result.current.addAll());
    expect(createFromQuickAdd.mock.calls[0]![0]).toBe('Email landlord');
  });

  it('keeps a result that lands after close for the next open, never adding it', async () => {
    const out = deferred<string>();
    generate.mockReturnValue(out.promise);
    const first = await open();
    await say('call mum');
    first.unmount();
    await act(async () => out.resolve('Call mum'));
    expect(createFromQuickAdd).not.toHaveBeenCalled();
    expect(useUi.getState().rambleLines).toEqual(['Call mum']);

    const second = await open();
    expect(second.result.current.drafts.map((d) => d.line)).toEqual(['Call mum']);
    expect(useUi.getState().rambleLines).toBeNull();
  });

  it('shows kept rows once under StrictMode', async () => {
    useUi.setState({ rambleLines: ['Call mum || ring after six'] });
    const { result } = renderHook(() => useRamble(() => {}), { wrapper: StrictMode });
    await act(async () => {});
    expect(result.current.drafts.map((d) => [d.line, d.notes])).toEqual([['Call mum', 'ring after six']]);
  });

  it('stops the mic when paused while it was still starting', async () => {
    const started = deferred<{ stop: () => void }>();
    const stop = vi.fn();
    vi.mocked(startSpeech).mockImplementationOnce(async (h) => {
      speech.handlers = h;
      return started.promise;
    });
    const { result } = renderHook(() => useRamble(() => {}));
    await act(async () => {
      void result.current.toggleMic();
    });
    await act(async () => started.resolve({ stop }));
    expect(stop).toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
  });

  it('will not add all while a single add is in flight', async () => {
    generate.mockResolvedValue('Call mum\nBuy milk');
    const one = deferred<void>();
    createFromQuickAdd.mockReturnValueOnce(one.promise).mockResolvedValue(undefined);
    const { result } = await open();
    await say('x');
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.addOne(result.current.drafts[0]!.id);
    });
    await act(() => result.current.addAll());
    expect(createFromQuickAdd).toHaveBeenCalledTimes(1);
    await act(async () => {
      one.resolve();
      await pending;
    });
  });

  describe('saving', () => {
    async function withTwoRows(onClose: () => void) {
      generate.mockResolvedValue('Call mum\nBuy milk');
      const view = await open(onClose);
      await say('x');
      return view;
    }

    it('ignores close until the save finishes', async () => {
      const onClose = vi.fn();
      const save = deferred<void>();
      createFromQuickAdd.mockReturnValue(save.promise);
      const { result } = await withTwoRows(onClose);
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
      const { result } = await withTwoRows(onClose);
      act(() => result.current.close());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close a reopened sheet when a save finishes after unmount', async () => {
      const onClose = vi.fn();
      const save = deferred<void>();
      createFromQuickAdd.mockReturnValue(save.promise);
      const first = await withTwoRows(onClose);
      let adding!: Promise<void>;
      act(() => {
        adding = first.result.current.addAll();
      });
      first.unmount();
      save.resolve();
      await adding;
      expect(onClose).not.toHaveBeenCalled();
    });

    it('keeps only the unsaved rows for next open when a save fails after unmount', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      createFromQuickAdd.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
      const first = await withTwoRows(() => {});
      let adding!: Promise<void>;
      act(() => {
        adding = first.result.current.addAll();
      });
      first.unmount();
      await adding;
      errorSpy.mockRestore();
      expect(useUi.getState().rambleLines).toEqual(['Buy milk']);
    });
  });
});
