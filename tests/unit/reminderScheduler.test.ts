// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const n = vi.hoisted(() => ({
  scheduleNotification: vi.fn(),
  pendingNotificationIds: vi.fn(),
  cancelNotifications: vi.fn(),
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  registerReminderActions: vi.fn(),
  onNotificationAction: vi.fn(),
  REMINDER_ACTION_TYPE: 'cria.reminder',
}));
const db = vi.hoisted(() => ({ listUnnotifiedReminders: vi.fn(), markReminderNotified: vi.fn() }));
const native = vi.hoisted(() => ({ nativeNotify: vi.fn() }));
const tasks = vi.hoisted(() => ({ updateTask: vi.fn() }));
vi.mock('@/tauri/notification', () => n);
vi.mock('@/db/reminders', () => db);
vi.mock('@/utils/notify', () => native);
vi.mock('@/db/tasks', () => tasks);

import {
  startScheduledReminders,
  startPollingReminders,
  reminderNotifId,
} from '@/sync/useReminderScheduler';
import { useSettings } from '@/stores/settings';
import { useUi } from '@/stores/ui';

const NOW = new Date('2026-09-24T12:00:00Z').getTime();
const rem = (task: string, minutesFromNow: number) => ({
  taskLocalId: task,
  taskTitle: `Title ${task}`,
  reminderAt: new Date(NOW + minutesFromNow * 60_000).toISOString(),
});
const idOf = (r: ReturnType<typeof rem>) => reminderNotifId(r.taskLocalId, r.reminderAt);
const flush = () => new Promise((r) => setTimeout(r, 0));

let actionHandler: (e: { actionId: string | null; extra: Record<string, unknown>; body: string | null }) => void;
let stop: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  useSettings.setState({ notificationsEnabled: true });
  n.pendingNotificationIds.mockResolvedValue([]);
  n.isPermissionGranted.mockResolvedValue(true);
  n.scheduleNotification.mockResolvedValue(undefined);
  n.onNotificationAction.mockImplementation(async (cb: typeof actionHandler) => {
    actionHandler = cb;
    return () => {};
  });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe('reminderNotifId', () => {
  it('is stable, 31-bit and differs per time', () => {
    const a = reminderNotifId('t1', '2026-10-01T09:00:00Z');
    expect(a).toBe(reminderNotifId('t1', '2026-10-01T09:00:00Z'));
    expect(a).not.toBe(reminderNotifId('t1', '2026-10-01T09:05:00Z'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 31);
  });
});

describe('mobile: OS-scheduled reminders', () => {
  it('schedules only future reminders the OS does not already have, soonest first', async () => {
    const past = rem('past', -5), later = rem('later', 120), soon = rem('soon', 10), have = rem('have', 30);
    db.listUnnotifiedReminders.mockResolvedValue([past, later, soon, have]);
    n.pendingNotificationIds.mockResolvedValue([idOf(have)]);
    stop = startScheduledReminders();
    await vi.waitFor(() => expect(n.scheduleNotification).toHaveBeenCalledTimes(2));
    expect(n.scheduleNotification.mock.calls.map((c) => c[0].extra.taskLocalId)).toEqual(['soon', 'later']);
    expect(n.scheduleNotification.mock.calls[0]![0]).toMatchObject({
      id: idOf(soon), title: 'Reminder', body: 'Title soon', actionTypeId: 'cria.reminder',
    });
  });

  it('caps scheduling at 60 (iOS allows 64 pending)', async () => {
    db.listUnnotifiedReminders.mockResolvedValue(Array.from({ length: 70 }, (_, i) => rem(`t${i}`, i + 1)));
    stop = startScheduledReminders();
    await vi.waitFor(() => expect(n.scheduleNotification).toHaveBeenCalledTimes(60));
  });

  it('cancels pending ids whose reminder is gone, keeping live and past-due ones', async () => {
    const live = rem('live', 30), pastDue = rem('pastdue', -1);
    db.listUnnotifiedReminders.mockResolvedValue([live, pastDue]);
    n.pendingNotificationIds.mockResolvedValue([idOf(live), idOf(pastDue), 12345]);
    stop = startScheduledReminders();
    await vi.waitFor(() => expect(n.cancelNotifications).toHaveBeenCalledWith([12345]));
  });

  it('cancels everything and schedules nothing when notifications are off', async () => {
    useSettings.setState({ notificationsEnabled: false });
    db.listUnnotifiedReminders.mockResolvedValue([rem('a', 30)]);
    n.pendingNotificationIds.mockResolvedValue([1, 2]);
    stop = startScheduledReminders();
    await vi.waitFor(() => expect(n.cancelNotifications).toHaveBeenCalledWith([1, 2]));
    expect(n.scheduleNotification).not.toHaveBeenCalled();
  });

  it('never prompts for permission when nothing is due to be scheduled', async () => {
    db.listUnnotifiedReminders.mockResolvedValue([rem('past', -5)]);
    n.isPermissionGranted.mockResolvedValue(false);
    stop = startScheduledReminders();
    await flush(); await flush();
    expect(n.requestPermission).not.toHaveBeenCalled();
  });

  it('schedules nothing if permission is denied', async () => {
    db.listUnnotifiedReminders.mockResolvedValue([rem('a', 30)]);
    n.isPermissionGranted.mockResolvedValue(false);
    n.requestPermission.mockResolvedValue('denied');
    stop = startScheduledReminders();
    await vi.waitFor(() => expect(n.requestPermission).toHaveBeenCalled());
    await flush();
    expect(n.scheduleNotification).not.toHaveBeenCalled();
  });

  describe('notification actions', () => {
    beforeEach(async () => {
      db.listUnnotifiedReminders.mockResolvedValue([]);
      tasks.updateTask.mockResolvedValue(undefined);
      stop = startScheduledReminders();
      await vi.waitFor(() => expect(actionHandler).toBeDefined());
    });

    it('Complete marks the task done', () => {
      actionHandler({ actionId: 'complete', extra: { taskLocalId: 't1' }, body: null });
      expect(tasks.updateTask).toHaveBeenCalledWith('t1', { done: true });
    });

    it('Snooze reschedules 10 min out and reconcile does not cancel it', async () => {
      const pressedAt = Date.now(); // vi.waitFor advances the fake clock
      actionHandler({ actionId: 'snooze', extra: { taskLocalId: 't1' }, body: 'Milk' });
      const call = n.scheduleNotification.mock.calls.at(-1)![0];
      expect(call).toMatchObject({ body: 'Milk', extra: { taskLocalId: 't1' } });
      expect(call.at.getTime() - pressedAt).toBe(10 * 60_000);

      n.pendingNotificationIds.mockResolvedValue([call.id]);
      n.cancelNotifications.mockClear();
      const { notify } = await import('@/db/bus');
      notify('tasks'); // triggers a reconcile
      await flush(); await flush();
      expect(n.cancelNotifications).not.toHaveBeenCalled();
    });

    it('a plain tap opens the task', () => {
      actionHandler({ actionId: null, extra: { taskLocalId: 't9' }, body: null });
      expect(useUi.getState().selectedTaskLocalId).toBe('t9');
    });

    it('ignores actions without a task id', () => {
      actionHandler({ actionId: 'complete', extra: {}, body: null });
      expect(tasks.updateTask).not.toHaveBeenCalled();
    });
  });
});

describe('desktop: polling reminders', () => {
  it('fires due reminders and marks them notified only if delivery succeeded', async () => {
    const due = rem('due', -1), undelivered = rem('undelivered', -2), future = rem('future', 5);
    db.listUnnotifiedReminders.mockResolvedValue([due, undelivered, future]);
    native.nativeNotify.mockImplementation(async (_t: string, body: string) => body === 'Title due');
    stop = startPollingReminders();
    await vi.waitFor(() => expect(native.nativeNotify).toHaveBeenCalledTimes(2));
    await flush();
    expect(db.markReminderNotified).toHaveBeenCalledTimes(1);
    expect(db.markReminderNotified).toHaveBeenCalledWith('due', due.reminderAt);
  });
});
