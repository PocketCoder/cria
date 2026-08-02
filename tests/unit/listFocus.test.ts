// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useListFocus } from '@/stores/listFocus';

beforeEach(() => {
  useListFocus.setState({ focusedId: null });
});

describe('useListFocus', () => {
  it('defaults to null', () => {
    expect(useListFocus.getState().focusedId).toBeNull();
  });

  it('setFocusedId sets the focused row', () => {
    useListFocus.getState().setFocusedId('t-abc');
    expect(useListFocus.getState().focusedId).toBe('t-abc');
  });

  it('setFocusedId(null) clears focus', () => {
    useListFocus.getState().setFocusedId('t-abc');
    useListFocus.getState().setFocusedId(null);
    expect(useListFocus.getState().focusedId).toBeNull();
  });
});
