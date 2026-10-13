import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { effectiveTraySettings, pushTraySettings } from '@/lib/traySettings';

describe('effectiveTraySettings', () => {
  it('passes the stored values through while the tray icon is on', () => {
    expect(
      effectiveTraySettings({ trayIconEnabled: true, closeToTray: true, hideDockOnTray: true }),
    ).toEqual({ trayIconEnabled: true, closeToTray: true, hideDockOnTray: true });
  });

  it('forces close-to-tray and hide-dock off while the tray icon is off', () => {
    expect(
      effectiveTraySettings({ trayIconEnabled: false, closeToTray: true, hideDockOnTray: true }),
    ).toEqual({ trayIconEnabled: false, closeToTray: false, hideDockOnTray: false });
  });

  it('forces hide-dock off when close-to-tray is off', () => {
    expect(
      effectiveTraySettings({ trayIconEnabled: true, closeToTray: false, hideDockOnTray: true }),
    ).toEqual({ trayIconEnabled: true, closeToTray: false, hideDockOnTray: false });
  });
});

describe('pushTraySettings', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it('turns close-to-tray and hide-dock off before hiding the tray icon', () => {
    pushTraySettings({ trayIconEnabled: false, closeToTray: true, hideDockOnTray: true });
    expect(invoke.mock.calls).toEqual([
      ['set_close_to_tray', { enabled: false }],
      ['set_hide_dock_on_tray', { enabled: false }],
      ['set_tray_visible', { visible: false }],
    ]);
  });

  it('shows the tray icon before restoring close-to-tray and hide-dock', () => {
    pushTraySettings({ trayIconEnabled: true, closeToTray: true, hideDockOnTray: true });
    expect(invoke.mock.calls).toEqual([
      ['set_tray_visible', { visible: true }],
      ['set_close_to_tray', { enabled: true }],
      ['set_hide_dock_on_tray', { enabled: true }],
    ]);
  });

  it('swallows command failures', () => {
    invoke.mockRejectedValue(new Error('nope'));
    expect(() =>
      pushTraySettings({ trayIconEnabled: true, closeToTray: true, hideDockOnTray: false }),
    ).not.toThrow();
  });
});
