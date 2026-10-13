import { invoke } from '@tauri-apps/api/core';

export interface TrayPrefs {
  trayIconEnabled: boolean;
  closeToTray: boolean;
  hideDockOnTray: boolean;
}

/**
 * What Rust should actually be told. Close-to-tray and hide-dock only make
 * sense while the tray icon is visible: with it hidden, closing the window
 * would strand the app with nothing to restore it (and no Dock icon either).
 * The stored preferences stay untouched so re-enabling the tray restores them.
 */
export function effectiveTraySettings(p: TrayPrefs): TrayPrefs {
  const closeToTray = p.closeToTray && p.trayIconEnabled;
  return {
    trayIconEnabled: p.trayIconEnabled,
    closeToTray,
    hideDockOnTray: p.hideDockOnTray && closeToTray,
  };
}

/**
 * Push all three tray commands from the stored prefs. Order matters: when the
 * tray is going away, switch close-to-tray / hide-dock off first so there is
 * never a window where they are on with no icon; when it is coming back, show
 * the icon first.
 */
export function pushTraySettings(prefs: TrayPrefs): void {
  const e = effectiveTraySettings(prefs);
  const send = (cmd: string, args: Record<string, boolean>) => {
    invoke(cmd, args).catch(() => {});
  };
  if (e.trayIconEnabled) send('set_tray_visible', { visible: true });
  send('set_close_to_tray', { enabled: e.closeToTray });
  send('set_hide_dock_on_tray', { enabled: e.hideDockOnTray });
  if (!e.trayIconEnabled) send('set_tray_visible', { visible: false });
}
