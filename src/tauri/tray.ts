/**
 * Tray icon — single static instance. Uses Tauri 2's core
 * `@tauri-apps/api/tray` (the `tray-icon` feature on the `tauri` crate
 * enables it; see src-tauri/Cargo.toml).
 *
 * If we ever want state-reactive icons back, expose setIcon/setTooltip
 * on this wrapper and have TrayIcon.tsx watch the relevant queries.
 */

import { TrayIcon as CoreTrayIcon } from '@tauri-apps/api/tray';
import { resolveResource } from '@tauri-apps/api/path';

const TRAY_ID = 'cria';

export class Tray {
  private constructor(_inner: CoreTrayIcon) {}

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
}
