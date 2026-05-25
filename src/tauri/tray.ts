/**
 * Tray icon wrapper. Uses Tauri 2's core `@tauri-apps/api/tray` API
 * (the `tray-icon` feature on the `tauri` crate enables it — see
 * src-tauri/Cargo.toml).
 *
 * Single tray icon keyed by id "cria". TrayIcon.getById() returns it if
 * we've already created one this session; otherwise we create it.
 *
 * Icon paths (e.g. "icons/icon_idle.png") are resolved against the app's
 * bundled resource dir via @tauri-apps/api/path::resolveResource.
 */

import { TrayIcon as CoreTrayIcon } from '@tauri-apps/api/tray';
import { resolveResource } from '@tauri-apps/api/path';

const TRAY_ID = 'cria';

export class Tray {
  private constructor(private inner: CoreTrayIcon) {}

  static async getCurrent(): Promise<Tray> {
    const existing = await CoreTrayIcon.getById(TRAY_ID);
    if (existing) return new Tray(existing);
    const iconPath = await resolveResource('icons/icon_idle.png');
    const created = await CoreTrayIcon.new({
      id: TRAY_ID,
      icon: iconPath,
      tooltip: 'Cria',
    });
    return new Tray(created);
  }

  async setIcon(filename: string): Promise<void> {
    const path = await resolveResource(`icons/${filename}`);
    await this.inner.setIcon(path);
  }

  async setTooltip(tooltip: string): Promise<void> {
    await this.inner.setTooltip(tooltip);
  }
}
