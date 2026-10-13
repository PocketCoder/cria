// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { useShellSearch } from '@/features/shell/useShellState';
import type { ActiveView } from '@/stores/ui';

const today: ActiveView = { kind: 'today' };
const search: ActiveView = { kind: 'search' };
const typed = (value: string) => ({ target: { value } }) as ChangeEvent<HTMLInputElement>;

describe('useShellSearch', () => {
  it('keeps the current view when search is cancelled before typing', () => {
    const setActiveView = vi.fn();
    const { result } = renderHook(() => useShellSearch(today, setActiveView));
    act(() => result.current.handleSearchClear());
    expect(setActiveView).not.toHaveBeenCalled();
  });

  it('falls back to Today when leaving search with no remembered view', () => {
    const setActiveView = vi.fn();
    const { result } = renderHook(() => useShellSearch(search, setActiveView));
    act(() => result.current.handleSearchClear());
    expect(setActiveView).toHaveBeenCalledWith(today);
  });

  it('restores the view that was active when typing started', () => {
    const project: ActiveView = { kind: 'project', localId: 'p1' };
    const setActiveView = vi.fn();
    const { result, rerender } = renderHook(({ view }) => useShellSearch(view, setActiveView), {
      initialProps: { view: project as ActiveView },
    });
    act(() => result.current.handleSearchChange(typed('milk')));
    expect(setActiveView).toHaveBeenLastCalledWith(search);
    rerender({ view: search });
    act(() => result.current.handleSearchClear());
    expect(setActiveView).toHaveBeenLastCalledWith(project);
  });

  it('falls back to Today when the query is emptied after typing from no view', () => {
    const setActiveView = vi.fn();
    const { result, rerender } = renderHook(({ view }) => useShellSearch(view, setActiveView), {
      initialProps: { view: null as ActiveView | null },
    });
    act(() => result.current.handleSearchChange(typed('milk')));
    rerender({ view: search });
    act(() => result.current.handleSearchChange(typed('')));
    expect(setActiveView).toHaveBeenLastCalledWith(today);
  });
});
