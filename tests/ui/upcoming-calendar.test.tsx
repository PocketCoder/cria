import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, cleanup } from '@testing-library/react';
import { UpcomingCalendar } from '@/features/smart-views/UpcomingCalendar';
import { useToday } from '@/hooks/useToday';

// jsdom has no layout: give the strip a width so `idx * clientWidth` is real.
const WIDTH = 300;
let clientWidth: PropertyDescriptor | undefined;

beforeEach(() => {
  clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: WIDTH });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

const TODAY = new Date(2026, 9, 2); // Fri 2 Oct 2026

function strip(container: HTMLElement) {
  return container.querySelector('.snap-x') as HTMLElement;
}

describe('UpcomingCalendar Today button', () => {
  it('re-centres the strip on the current week after swiping away', () => {
    const { container } = render(
      <UpcomingCalendar taskDays={new Set()} today={TODAY} selected={TODAY} onPickDay={() => {}} />,
    );
    const el = strip(container);
    const home = el.scrollLeft;
    expect(home).toBeGreaterThan(0);

    // Swipe three weeks ahead; `selected` (already today) never changes.
    el.scrollLeft = home + 3 * WIDTH;
    fireEvent.click(screen.getByText('Today'));
    expect(el.scrollLeft).toBe(home);

    // And again: the second tap must work too.
    el.scrollLeft = home + 3 * WIDTH;
    fireEvent.click(screen.getByText('Today'));
    expect(el.scrollLeft).toBe(home);
  });
});

describe('useToday', () => {
  it('rolls over at midnight and keeps a stable reference within a day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 2, 23, 59, 0));
    const { result } = renderHook(() => useToday());
    const first = result.current;
    expect(first).toEqual(new Date(2026, 9, 2));

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe(first);

    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(result.current).toEqual(new Date(2026, 9, 3));
  });

  it('re-checks the day when the page returns to the foreground', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 2, 12, 0, 0));
    const { result } = renderHook(() => useToday());
    // Clock jumps (suspended app) without the timer firing.
    vi.setSystemTime(new Date(2026, 9, 4, 9, 0, 0));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toEqual(new Date(2026, 9, 4));
  });
});
