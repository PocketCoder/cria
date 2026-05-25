// Stub import – real implementation provided by Tauri in production
import { Tray } from '@/tauri/tray';
import { useEffect } from 'react';
import { useOutboxCount } from '@/queries/outbox';
import { useConflictsCount } from '@/queries/conflicts';

/** Simple tray icon that reflects sync status */
export function TrayIcon() {
  const { data: outboxCount = 0 } = useOutboxCount();
  const { data: conflictCount = 0 } = useConflictsCount();

  useEffect(() => {
    // Initialize tray only once
    const init = async () => {
      const tray = await Tray.getCurrent();
      // Set initial icon based on status
      await updateTrayIcon(tray, outboxCount, conflictCount);
    };
    init();
  }, []);

  // Update icon whenever counts change
  useEffect(() => {
    const update = async () => {
      const tray = await Tray.getCurrent();
      await updateTrayIcon(tray, outboxCount, conflictCount);
    };
    update();
  }, [outboxCount, conflictCount]);

  return null; // No JSX – side‑effect component only
}

async function updateTrayIcon(tray: Tray, outbox: number, conflicts: number) {
  // Choose icon based on priority: conflict > outbox > idle
  let icon = 'icon_idle.png';
  if (conflicts > 0) {
    icon = 'icon_conflict.png';
  } else if (outbox > 0) {
    icon = 'icon_sync.png';
  }
  await tray.setIcon(icon);
  // Tooltip
  const tooltip = conflicts
    ? `${conflicts} conflict(s) pending`
    : outbox
    ? `${outbox} pending mutation(s)`
    : 'Synced';
  await tray.setTooltip(tooltip);
}
