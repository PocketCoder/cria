import { useEffect } from 'react';
import { Tray } from '@/tauri/tray';

/**
 * Mounts the OS tray icon once at startup. The icon and tooltip are
 * static — see `src/tauri/tray.ts` and `src-tauri/icons/icon_idle.png`.
 *
 * State-reactive tray (conflict / sync / idle swap) was tried and
 * removed: the footer dot covers the same signal without bouncing the
 * menubar on every outbox tick.
 */
export function TrayIcon() {
  useEffect(() => {
    void Tray.getCurrent();
  }, []);
  return null;
}
