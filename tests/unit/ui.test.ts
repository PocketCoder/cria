// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUi } from '@/stores/ui';

beforeEach(() => {
  useUi.setState({
    activeView: { kind: 'today' },
    selectedTaskLocalId: null,
    sidebarCollapsed: false,
  });
});

describe('useUi', () => {
  it('default state has today as active view', () => {
    const state = useUi.getState();
    expect(state.activeView).toEqual({ kind: 'today' });
    expect(state.selectedTaskLocalId).toBeNull();
    expect(state.sidebarCollapsed).toBe(false);
  });

  it('setActiveView sets view and clears selected task', () => {
    useUi.getState().setActiveView({ kind: 'project', localId: 'p1' });
    const state = useUi.getState();
    expect(state.activeView).toEqual({ kind: 'project', localId: 'p1' });
    expect(state.selectedTaskLocalId).toBeNull();
  });

  it('setActiveView(null) clears view', () => {
    useUi.getState().setActiveView(null);
    expect(useUi.getState().activeView).toBeNull();
  });

  it('setActiveView clears selected task when one was set', () => {
    useUi.getState().setSelectedTask('t1');
    useUi.getState().setActiveView({ kind: 'inbox' });
    expect(useUi.getState().selectedTaskLocalId).toBeNull();
  });

  it('setSelectedProject sets project view with id', () => {
    useUi.getState().setSelectedProject('p42');
    const state = useUi.getState();
    expect(state.activeView).toEqual({ kind: 'project', localId: 'p42' });
    expect(state.selectedTaskLocalId).toBeNull();
  });

  it('setSelectedProject(null) clears active view', () => {
    useUi.getState().setSelectedProject(null);
    expect(useUi.getState().activeView).toBeNull();
  });

  it('setSelectedProject clears selected task', () => {
    useUi.getState().setSelectedTask('t1');
    useUi.getState().setSelectedProject('p2');
    expect(useUi.getState().selectedTaskLocalId).toBeNull();
  });

  it('setSelectedTask sets task id', () => {
    useUi.getState().setSelectedTask('t-abc');
    expect(useUi.getState().selectedTaskLocalId).toBe('t-abc');
  });

  it('setSelectedTask(null) clears task', () => {
    useUi.getState().setSelectedTask('t1');
    useUi.getState().setSelectedTask(null);
    expect(useUi.getState().selectedTaskLocalId).toBeNull();
  });

  it('toggleSidebar toggles from false to true', () => {
    expect(useUi.getState().sidebarCollapsed).toBe(false);
    useUi.getState().toggleSidebar();
    expect(useUi.getState().sidebarCollapsed).toBe(true);
  });

  it('toggleSidebar toggles from true to false', () => {
    useUi.setState({ sidebarCollapsed: true });
    useUi.getState().toggleSidebar();
    expect(useUi.getState().sidebarCollapsed).toBe(false);
  });

  it('persist middleware stores activeView and sidebarCollapsed, not selectedTask', () => {
    useUi.getState().setActiveView({ kind: 'project', localId: 'p1' });
    useUi.getState().setSelectedTask('t1');
    useUi.getState().toggleSidebar();
    const state = useUi.getState();
    expect(state.activeView).toEqual({ kind: 'project', localId: 'p1' });
    expect(state.sidebarCollapsed).toBe(true);
    expect(state.selectedTaskLocalId).toBe('t1');
  });
});
