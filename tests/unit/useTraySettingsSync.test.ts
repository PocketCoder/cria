// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { invoke, mobile } = vi.hoisted(() => ({
  invoke: vi.fn(),
  mobile: { value: false },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => mobile.value }));

import { useTraySettingsSync } from '@/features/shell/useShellEffects';
import { useSettings } from '@/stores/settings';

describe('useTraySettingsSync', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    mobile.value = false;
  });

  it('pushes all three persisted tray settings to Rust on startup', () => {
    useSettings.setState({ trayIconEnabled: true, closeToTray: true, hideDockOnTray: true });
    renderHook(() => useTraySettingsSync());
    expect(invoke).toHaveBeenCalledWith('set_tray_visible', { visible: true });
    expect(invoke).toHaveBeenCalledWith('set_close_to_tray', { enabled: true });
    expect(invoke).toHaveBeenCalledWith('set_hide_dock_on_tray', { enabled: true });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it('sends close-to-tray and hide-dock as false while the tray icon is off', () => {
    useSettings.setState({ trayIconEnabled: false, closeToTray: true, hideDockOnTray: true });
    renderHook(() => useTraySettingsSync());
    expect(invoke).toHaveBeenCalledWith('set_tray_visible', { visible: false });
    expect(invoke).toHaveBeenCalledWith('set_close_to_tray', { enabled: false });
    expect(invoke).toHaveBeenCalledWith('set_hide_dock_on_tray', { enabled: false });
    // Stored preferences are left alone so re-enabling the tray restores them.
    expect(useSettings.getState().closeToTray).toBe(true);
    expect(useSettings.getState().hideDockOnTray).toBe(true);
  });

  it('does nothing on mobile, where the commands do not exist', () => {
    mobile.value = true;
    renderHook(() => useTraySettingsSync());
    expect(invoke).not.toHaveBeenCalled();
  });

  it('swallows command failures', () => {
    invoke.mockRejectedValue(new Error('nope'));
    expect(() => renderHook(() => useTraySettingsSync())).not.toThrow();
  });
});
