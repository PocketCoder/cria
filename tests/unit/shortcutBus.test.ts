import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onShortcut, emitShortcut } from '@/lib/shortcutBus';

// The listeners map is pinned on globalThis (HMR-safety); wipe it between
// tests so subscriptions don't leak across cases.
beforeEach(() => {
  globalThis.__cria_shortcutListeners__ = undefined;
});

describe('shortcutBus', () => {
  it('onShortcut registers a listener invoked by emitShortcut', () => {
    const fn = vi.fn();
    onShortcut('task.done', fn);
    expect(emitShortcut('task.done')).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('onShortcut returns an unsubscribe that stops delivery', () => {
    const fn = vi.fn();
    const off = onShortcut('task.done', fn);
    off();
    expect(emitShortcut('task.done')).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('unsubscribe is idempotent', () => {
    const fn = vi.fn();
    const off = onShortcut('task.done', fn);
    off();
    off();
    expect(emitShortcut('task.done')).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('emitShortcut returns false and is a no-op when no listeners exist', () => {
    expect(emitShortcut('task.done')).toBe(false);
  });

  it('emitShortcut only fires listeners for the matching action', () => {
    const a = vi.fn();
    const b = vi.fn();
    onShortcut('task.done', a);
    onShortcut('task.move', b);
    emitShortcut('task.done');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('emitShortcut catches listener errors and keeps delivering', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    onShortcut('task.done', bad);
    onShortcut('task.done', good);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(emitShortcut('task.done')).toBe(true);
    expect(good).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('snapshot iteration — listeners added during emit are not called this round', () => {
    const first = vi.fn();
    const second = vi.fn();
    onShortcut('task.done', first);
    onShortcut('task.done', () => onShortcut('task.done', second));
    emitShortcut('task.done');
    expect(second).not.toHaveBeenCalled();
    emitShortcut('task.done');
    expect(second).toHaveBeenCalledTimes(1);
  });
});
