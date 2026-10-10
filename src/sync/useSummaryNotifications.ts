import { useEffect } from 'react';
import { format, subDays } from 'date-fns';
import { useAuth } from '@/auth/store';
import { useSettings } from '@/stores/settings';
import { useCurrentUser } from '@/queries/user';
import { listTasksWithDueDate, countTasksDoneSince } from '@/db/tasks';
import { subscribe } from '@/db/bus';
import { nativeNotify } from '@/utils/notify';
import {
  scheduleNotification,
  cancelNotifications,
  isPermissionGranted,
  requestPermission,
} from '@/tauri/notification';
import { isMobilePlatform } from '@/lib/platform';
import { onVisibilityChange } from '@/lib/visibility';
import {
  isSummaryDue,
  morningSummary,
  weeklyRoundup,
  nextFireAt,
  type SummaryMessage,
} from '@/lib/summaries';

const TICK_MS = 60_000;
// Opening the app well after the set time shouldn't deliver a stale summary.
const GRACE_MS = 3 * 60 * 60_000;
// Fixed ids so re-scheduling replaces the pending notification (mobile).
const MORNING_ID = 2_000_000_001;
const WEEKLY_ID = 2_000_000_002;

type Kind = 'morning' | 'weekly';

interface Config {
  morning: { enabled: boolean; time: string };
  weekly: { enabled: boolean; time: string };
  /** 0 = Sunday … 6 = Saturday; the weekly round-up fires on this day. */
  weekStart: number;
}

async function buildMessage(kind: Kind, at: Date): Promise<SummaryMessage> {
  const open = await listTasksWithDueDate();
  if (kind === 'morning') return morningSummary(open, at);
  const done = await countTasksDoneSince(subDays(at, 7).toISOString()).catch(() => 0);
  return weeklyRoundup(open, done, at);
}

function lastFiredKey(kind: Kind): string {
  return `cria:summary-last/${kind}`;
}

function readLastFired(kind: Kind): string | null {
  try {
    return localStorage.getItem(lastFiredKey(kind));
  } catch {
    return null;
  }
}

function writeLastFired(kind: Kind, day: string): void {
  try {
    localStorage.setItem(lastFiredKey(kind), day);
  } catch {
    // Storage unavailable: worst case the summary can fire again this session.
  }
}

/**
 * Desktop: poll, and fire each summary once per day when its time has passed
 * (within a grace window) while the app or tray is running.
 */
export function startPollingSummaries(getConfig: () => Config): () => void {
  let cancelled = false;

  const tick = async () => {
    const cfg = getConfig();
    const now = new Date();
    const dayKey = format(now, 'yyyy-MM-dd');
    const jobs: { kind: Kind; time: string; weekday?: number }[] = [];
    if (cfg.morning.enabled) jobs.push({ kind: 'morning', time: cfg.morning.time });
    if (cfg.weekly.enabled) {
      jobs.push({ kind: 'weekly', time: cfg.weekly.time, weekday: cfg.weekStart });
    }
    for (const job of jobs) {
      if (cancelled) return;
      if (!isSummaryDue(now, job.time, readLastFired(job.kind), dayKey, GRACE_MS, job.weekday)) {
        continue;
      }
      try {
        const msg = await buildMessage(job.kind, now);
        // Only mark fired if the OS accepted it, so a denied-permission period
        // doesn't burn today's summary.
        if (await nativeNotify(msg.title, msg.body)) writeLastFired(job.kind, dayKey);
      } catch (err) {
        console.warn('[summary-notifications] tick failed:', err);
      }
    }
  };

  void tick();
  const id = setInterval(() => void tick(), TICK_MS);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
}

/**
 * Mobile: hand the next occurrence of each summary to the OS so it fires with
 * the app closed. The body is computed when scheduling, so we re-schedule on
 * task changes and on foreground to keep the counts fresh.
 */
export function startScheduledSummaries(getConfig: () => Config): () => void {
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  let queued = false;

  const reconcile = async () => {
    const cfg = getConfig();
    const notificationsOn = useSettings.getState().notificationsEnabled;
    const wanted: { kind: Kind; id: number; time: string; weekday?: number }[] = [];
    if (notificationsOn && cfg.morning.enabled) {
      wanted.push({ kind: 'morning', id: MORNING_ID, time: cfg.morning.time });
    }
    if (notificationsOn && cfg.weekly.enabled) {
      wanted.push({ kind: 'weekly', id: WEEKLY_ID, time: cfg.weekly.time, weekday: cfg.weekStart });
    }
    const unwanted = [MORNING_ID, WEEKLY_ID].filter((id) => !wanted.some((w) => w.id === id));
    if (unwanted.length) await cancelNotifications(unwanted);
    if (wanted.length === 0) return;

    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (!granted) return;

    for (const job of wanted) {
      const at = nextFireAt(new Date(), job.time, job.weekday);
      const msg = await buildMessage(job.kind, at);
      await scheduleNotification({ id: job.id, title: msg.title, body: msg.body, at });
    }
  };

  const trigger = (): void => {
    if (disposed) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = reconcile()
      .catch((err) => console.warn('[summary-notifications] reconcile failed:', err))
      .finally(() => {
        inFlight = null;
        if (queued && !disposed) {
          queued = false;
          trigger();
        }
      });
  };

  trigger();
  const unsubTasks = subscribe('tasks', trigger);
  const stopVisibility = onVisibilityChange({ onShow: trigger });
  return () => {
    disposed = true;
    unsubTasks();
    stopVisibility();
  };
}

/**
 * Morning summary + weekly round-up notifications, per the Notifications
 * settings. The round-up lands on the user's week-start day. Mount once at the
 * app root.
 */
export function useSummaryNotifications(): void {
  const isAuthed = useAuth((s) => s.status.kind === 'authenticated');
  const { data: user } = useCurrentUser();
  const weekStart = user?.weekStart ?? 1;
  const notificationsEnabled = useSettings((s) => s.notificationsEnabled);
  const morningEnabled = useSettings((s) => s.morningSummaryEnabled);
  const morningTime = useSettings((s) => s.morningSummaryTime);
  const weeklyEnabled = useSettings((s) => s.weeklyRoundupEnabled);
  const weeklyTime = useSettings((s) => s.weeklyRoundupTime);

  useEffect(() => {
    if (!isAuthed) return;
    const getConfig = (): Config => ({
      morning: { enabled: morningEnabled, time: morningTime },
      weekly: { enabled: weeklyEnabled, time: weeklyTime },
      weekStart,
    });
    return isMobilePlatform() ? startScheduledSummaries(getConfig) : startPollingSummaries(getConfig);
  }, [isAuthed, notificationsEnabled, morningEnabled, morningTime, weeklyEnabled, weeklyTime, weekStart]);
}
