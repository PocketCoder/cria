// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const n = vi.hoisted(() => ({
  scheduleNotification: vi.fn(),
  cancelNotifications: vi.fn(),
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
}));
const native = vi.hoisted(() => ({ nativeNotify: vi.fn() }));
const tasks = vi.hoisted(() => ({
  listTasksWithDueDate: vi.fn(),
  countTasksDoneSince: vi.fn(),
}));
vi.mock('@/tauri/notification', () => n);
vi.mock('@/utils/notify', () => native);
vi.mock('@/db/tasks', () => tasks);

import { startPollingSummaries, startScheduledSummaries } from '@/sync/useSummaryNotifications';
import { useSettings } from '@/stores/settings';

// Sat 10 Oct 2026, 08:30 local.
const NOW = new Date(2026, 9, 10, 8, 30).getTime();
const cfg = (over: Record<string, unknown> = {}) => () => ({
  morning: { enabled: true, time: '08:00' },
  weekly: { enabled: false, time: '09:00' },
  weekStart: 6,
  ...over,
}) as Parameters<typeof startPollingSummaries>[0] extends () => infer C ? C : never;
const flush = () => new Promise((r) => setTimeout(r, 0));

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  useSettings.setState({ notificationsEnabled: true });
  tasks.listTasksWithDueDate.mockResolvedValue([
    { title: 'Now', dueDate: '2026-10-10T00:00:00Z', done: false },
  ]);
  tasks.countTasksDoneSince.mockResolvedValue(4);
  native.nativeNotify.mockResolvedValue(true);
  n.isPermissionGranted.mockResolvedValue(true);
  n.scheduleNotification.mockResolvedValue(undefined);
  n.cancelNotifications.mockResolvedValue(undefined);
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe('startPollingSummaries (desktop)', () => {
  it('fires the morning summary once when due, then not again that day', async () => {
    stop = startPollingSummaries(cfg());
    await vi.advanceTimersByTimeAsync(0);
    expect(native.nativeNotify).toHaveBeenCalledWith('Today', '1 due today. Start with: Now');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(native.nativeNotify).toHaveBeenCalledTimes(1);
  });

  it('does not mark fired when the OS rejects, so it retries', async () => {
    native.nativeNotify.mockResolvedValue(false);
    stop = startPollingSummaries(cfg());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(native.nativeNotify).toHaveBeenCalledTimes(2);
  });

  it('does nothing when disabled', async () => {
    stop = startPollingSummaries(cfg({ morning: { enabled: false, time: '08:00' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(native.nativeNotify).not.toHaveBeenCalled();
  });

  it('skips a summary whose time is past the grace window', async () => {
    stop = startPollingSummaries(cfg({ morning: { enabled: true, time: '03:00' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(native.nativeNotify).not.toHaveBeenCalled();
  });

  it('fires the weekly round-up only on the week-start day', async () => {
    const weekly = { weekly: { enabled: true, time: '08:00' }, morning: { enabled: false, time: '08:00' } };
    stop = startPollingSummaries(cfg({ ...weekly, weekStart: 1 })); // Monday; today is Saturday
    await vi.advanceTimersByTimeAsync(0);
    expect(native.nativeNotify).not.toHaveBeenCalled();
    stop();
    stop = startPollingSummaries(cfg({ ...weekly, weekStart: 6 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(native.nativeNotify).toHaveBeenCalledWith(
      'Your week',
      '4 tasks done last week, 1 due in the next 7 days.',
    );
  });
});

describe('startScheduledSummaries (mobile)', () => {
  it('schedules the next morning occurrence with the OS', async () => {
    stop = startScheduledSummaries(cfg());
    await flush();
    expect(n.scheduleNotification).toHaveBeenCalledTimes(1);
    const call = n.scheduleNotification.mock.calls[0]![0];
    expect(call.at).toEqual(new Date(2026, 9, 11, 8, 0)); // tomorrow, 08:00 has passed today
    // Content is computed for the fire day: today's task is overdue by then.
    expect(call.title).toBe('Today');
    expect(call.body).toBe('1 overdue. Start with: Now');
  });

  it('cancels summaries that are switched off', async () => {
    stop = startScheduledSummaries(cfg({ morning: { enabled: false, time: '08:00' } }));
    await flush();
    expect(n.cancelNotifications).toHaveBeenCalledWith([2_000_000_001, 2_000_000_002]);
    expect(n.scheduleNotification).not.toHaveBeenCalled();
  });

  it('cancels everything when notifications are off globally', async () => {
    useSettings.setState({ notificationsEnabled: false });
    stop = startScheduledSummaries(cfg());
    await flush();
    expect(n.cancelNotifications).toHaveBeenCalledWith([2_000_000_001, 2_000_000_002]);
    expect(n.scheduleNotification).not.toHaveBeenCalled();
  });

  it('does not schedule when permission is denied', async () => {
    n.isPermissionGranted.mockResolvedValue(false);
    n.requestPermission.mockResolvedValue('denied');
    stop = startScheduledSummaries(cfg());
    await flush();
    expect(n.scheduleNotification).not.toHaveBeenCalled();
  });
});

describe('summary settings defaults', () => {
  it('are on, 08:00 and 09:00', () => {
    const s = useSettings.getState();
    expect(s.morningSummaryEnabled).toBe(true);
    expect(s.morningSummaryTime).toBe('08:00');
    expect(s.weeklyRoundupEnabled).toBe(true);
    expect(s.weeklyRoundupTime).toBe('09:00');
  });
});
