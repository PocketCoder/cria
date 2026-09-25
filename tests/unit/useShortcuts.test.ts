// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useShortcuts } from '@/hooks/useShortcuts';
import { useUi } from '@/stores/ui';
import { onShortcut } from '@/lib/shortcutBus';
import type { ViewKind } from '@/domain/view';

// React 18.3 exports `act` on the `react` module; @types/react doesn't type
// it yet. Marking the act environment enables synchronous effect flushing and
// silences React's "not configured to support act(...)" warning.
const act = (React as unknown as { act: (cb: () => void) => void }).act;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const handlers = {
  switchView: vi.fn<(kind: ViewKind) => void>(),
  openQuickSearch: vi.fn(),
  openLabelManager: vi.fn(),
  openTeams: vi.fn(),
};

function Harness() {
  useShortcuts(handlers);
  return null;
}

let root: Root;
let container: HTMLDivElement;

function press(key: string, init: KeyboardEventInit = {}) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

function pressInInput(key: string, init: KeyboardEventInit = {}) {
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  input.remove();
}

beforeEach(() => {
  handlers.switchView.mockReset();
  handlers.openQuickSearch.mockReset();
  handlers.openLabelManager.mockReset();
  handlers.openTeams.mockReset();
  globalThis.__cria_shortcutListeners__ = undefined;
  useUi.setState({
    activeView: { kind: 'project', localId: 'p1' },
    selectedTaskLocalId: 't1',
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness));
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe('useShortcuts', () => {
  it('mod+k fires quick search from any context', () => {
    press('k', { metaKey: true });
    expect(handlers.openQuickSearch).toHaveBeenCalledTimes(1);
  });

  it('g then o navigates to Today', () => {
    press('g');
    press('o');
    expect(useUi.getState().activeView).toEqual({ kind: 'today' });
  });

  it('g then l switches to the list view inside a project', () => {
    press('g');
    press('l');
    expect(handlers.switchView).toHaveBeenCalledWith('list');
  });

  it('project view shortcuts do not fire outside a project view', () => {
    useUi.setState({ activeView: { kind: 'today' } });
    press('g');
    press('l');
    expect(handlers.switchView).not.toHaveBeenCalled();
  });

  it('task shortcuts dispatch over the bus when a task is selected', () => {
    const spy = vi.fn();
    onShortcut('task.done', spy);
    press('t');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('task shortcuts are ignored without a selected task', () => {
    useUi.setState({ selectedTaskLocalId: null });
    const spy = vi.fn();
    onShortcut('task.done', spy);
    press('t');
    expect(spy).not.toHaveBeenCalled();
  });

  it('list shortcuts fire inside a project view', () => {
    const spy = vi.fn();
    onShortcut('list.down', spy);
    press('j');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('list shortcuts are ignored outside a project view', () => {
    useUi.setState({ activeView: { kind: 'inbox' } });
    const spy = vi.fn();
    onShortcut('list.down', spy);
    press('j');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not fire shortcuts while typing in an input', () => {
    const spy = vi.fn();
    onShortcut('task.done', spy);
    pressInInput('t');
    pressInInput('k', { metaKey: true });
    expect(spy).not.toHaveBeenCalled();
    expect(handlers.openQuickSearch).not.toHaveBeenCalled();
  });

  it('a lone . resolves to copy-id after the sequence window', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    onShortcut('task.copyId', spy);
    press('.');
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('.. resolves to copy-id + title after the sequence window', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    onShortcut('task.copyIdTitle', spy);
    press('.');
    press('.');
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('... fires copy-id + title + url on the third dot', () => {
    const spy = vi.fn();
    onShortcut('task.copyIdTitleUrl', spy);
    press('.');
    press('.');
    press('.');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
