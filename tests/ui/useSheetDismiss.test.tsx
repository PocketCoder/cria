import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSheetDismiss } from '@/lib/useSheetDismiss';

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (q: string) => ({ matches: reduce && q.includes('reduce'), addEventListener() {}, removeEventListener() {} }),
  );
  window.matchMedia = globalThis.matchMedia;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSheetDismiss', () => {
  it('slides the sheet out, then closes once', () => {
    vi.useFakeTimers();
    stubMatchMedia(false);
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetDismiss(onClose, true));
    const el = document.createElement('div');
    (result.current.panelRef as { current: HTMLDivElement | null }).current = el;

    act(() => {
      result.current.requestClose();
      result.current.requestClose();
    });
    expect(el.style.transform).toBe('translateY(100%)');
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes immediately under reduced motion', () => {
    stubMatchMedia(true);
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetDismiss(onClose, true));
    act(() => result.current.requestClose());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
