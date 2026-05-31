import { useEffect } from 'react';
import { useAuth } from '@/auth/store';
import { listUnnotifiedReminders, markReminderNotified } from '@/db/reminders';
import { nativeNotify } from '@/utils/notify';

const TICK_MS = 30_000;

/**
 * Fires a desktop notification for each reminder whose time has passed and
 * that this device hasn't notified yet, then marks it notified so it won't
 * re-fire. Runs while the app is open or sitting in the tray; if the app
 * is fully quit it won't fire (Vikunja's server still sends its own
 * reminder notifications) — acceptable for v1.
 *
 * "Due now" is decided here in JS (Date comparison) rather than in SQL, to
 * sidestep ISO-string-compare pitfalls across timezone offsets.
 *
 * Mount once at the app root, gated on auth.
 */
export function useReminderScheduler(): void {
  const isAuthed = useAuth((s) => s.status.kind === 'authenticated');

  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const reminders = await listUnnotifiedReminders();
        const now = Date.now();
        for (const r of reminders) {
          if (cancelled) return;
          const at = new Date(r.reminderAt).getTime();
          if (Number.isNaN(at) || at > now) continue; // not due yet
          const fired = await nativeNotify('Reminder', r.taskTitle);
          // Only mark notified if the OS actually accepted delivery — otherwise
          // a "notifications off" period would silently burn reminders the user
          // expected to see, and re-enabling permission wouldn't recover them.
          if (fired) await markReminderNotified(r.taskLocalId, r.reminderAt);
        }
      } catch (err) {
        console.warn('[reminder-scheduler] tick failed:', err);
      }
    };

    void tick(); // run once on mount
    const id = setInterval(() => void tick(), TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isAuthed]);
}
