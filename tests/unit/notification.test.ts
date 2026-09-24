import { describe, it, expect, vi, beforeEach } from 'vitest';

const plugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  pending: vi.fn(),
  cancel: vi.fn(),
  registerActionTypes: vi.fn(),
  onAction: vi.fn(),
  Schedule: { at: vi.fn((at: Date, repeating: boolean, allowWhileIdle: boolean) => ({ at, repeating, allowWhileIdle })) },
}));
vi.mock('@tauri-apps/plugin-notification', () => plugin);

import {
  requestPermission,
  scheduleNotification,
  pendingNotificationIds,
  cancelNotifications,
  registerReminderActions,
  onNotificationAction,
  REMINDER_ACTION_TYPE,
} from '@/tauri/notification';

beforeEach(() => vi.clearAllMocks());

describe('tauri/notification wrapper', () => {
  it('maps any non-granted permission result to denied', async () => {
    plugin.requestPermission.mockResolvedValue('default');
    expect(await requestPermission()).toBe('denied');
    plugin.requestPermission.mockResolvedValue('granted');
    expect(await requestPermission()).toBe('granted');
  });

  it('schedules a one-shot, idle-allowed notification with action type + extra', async () => {
    const at = new Date('2026-10-01T09:00:00Z');
    await scheduleNotification({ id: 7, title: 'Reminder', body: 'Buy milk', at, actionTypeId: REMINDER_ACTION_TYPE, extra: { taskLocalId: 't1' } });
    expect(plugin.Schedule.at).toHaveBeenCalledWith(at, false, true);
    expect(plugin.sendNotification).toHaveBeenCalledWith({
      id: 7, title: 'Reminder', body: 'Buy milk',
      schedule: { at, repeating: false, allowWhileIdle: true },
      actionTypeId: REMINDER_ACTION_TYPE, extra: { taskLocalId: 't1' },
    });
  });

  it('omits actionTypeId/extra when not given', async () => {
    await scheduleNotification({ id: 1, title: 't', body: 'b', at: new Date() });
    const arg = plugin.sendNotification.mock.calls[0]![0];
    expect(arg).not.toHaveProperty('actionTypeId');
    expect(arg).not.toHaveProperty('extra');
  });

  it('lists pending ids and skips cancel for an empty list', async () => {
    plugin.pending.mockResolvedValue([{ id: 3 }, { id: 9 }]);
    expect(await pendingNotificationIds()).toEqual([3, 9]);
    await cancelNotifications([]);
    expect(plugin.cancel).not.toHaveBeenCalled();
    await cancelNotifications([3]);
    expect(plugin.cancel).toHaveBeenCalledWith([3]);
  });

  it('registerReminderActions swallows plugin errors', async () => {
    plugin.registerActionTypes.mockRejectedValue(new Error('unsupported'));
    await expect(registerReminderActions()).resolves.toBeUndefined();
  });

  it.each([
    ['nested (iOS)', { actionId: 'complete', notification: { extra: { taskLocalId: 't1' }, body: 'Milk' } }, { actionId: 'complete', extra: { taskLocalId: 't1' }, body: 'Milk' }],
    ['flat', { action: 'snooze', extra: { taskLocalId: 't2' }, body: 'Eggs' }, { actionId: 'snooze', extra: { taskLocalId: 't2' }, body: 'Eggs' }],
    ['empty', undefined, { actionId: null, extra: {}, body: null }],
  ])('normalises %s action payloads', async (_n, payload, expected) => {
    const unregister = vi.fn();
    plugin.onAction.mockImplementation(async (h: (p: unknown) => void) => {
      h(payload);
      return { unregister };
    });
    const cb = vi.fn();
    const un = await onNotificationAction(cb);
    expect(cb).toHaveBeenCalledWith(expected);
    un();
    expect(unregister).toHaveBeenCalled();
  });
});
