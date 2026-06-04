import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';
import {
  replaceTaskRemindersFromServer,
  listRemindersForTask,
  listUnnotifiedReminders,
  markReminderNotified,
  addReminder,
  removeReminder,
} from '@/db/reminders';

const now = () => new Date().toISOString();

describe('db/reminders', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  async function seedProjectAndTask() {
    const db = await getDb();
    await db.execute(
      `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
      ['proj1', 1, 'Project', now()],
    );
    await db.execute(
      `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
      ['task1', 'proj1', 'Remind me', now()],
    );
  }

  describe('replaceTaskRemindersFromServer', () => {
    it('replaces all reminders for a task', async () => {
      await seedProjectAndTask();
      const db = await getDb();
      // Pre-seed an old reminder that should be wiped
      await db.execute(
        `INSERT INTO task_reminders (task_local_id, reminder_at, notified) VALUES (?, ?, 0)`,
        ['task1', '2025-01-01T00:00:00Z'],
      );
      await replaceTaskRemindersFromServer('task1', [
        { reminder: '2026-06-01T00:00:00Z' },
        { reminder: '2026-07-01T00:00:00Z' },
      ] as any);
      const rows = await db.select<{ reminder_at: string }[]>(
        `SELECT reminder_at FROM task_reminders WHERE task_local_id = ? ORDER BY reminder_at ASC`,
        ['task1'],
      );
      expect(rows.map((r) => r.reminder_at)).toEqual([
        '2026-06-01T00:00:00Z',
        '2026-07-01T00:00:00Z',
      ]);
    });

    it('skips the Vikunja sentinel zero-date', async () => {
      await seedProjectAndTask();
      await replaceTaskRemindersFromServer('task1', [
        { reminder: '0001-01-01T00:00:00Z' },
        { reminder: '2026-06-01T00:00:00Z' },
      ] as any);
      const reminders = await listRemindersForTask('task1');
      expect(reminders.map((r) => r.reminderAt)).toEqual(['2026-06-01T00:00:00Z']);
    });

    it('handles relative reminders with no resolved time', async () => {
      await seedProjectAndTask();
      await replaceTaskRemindersFromServer('task1', [
        { reminder: null as any, relative_period: -3600, relative_to: 'due_date' },
      ] as any);
      const reminders = await listRemindersForTask('task1');
      expect(reminders[0]!.reminderAt).toBeNull();
      expect(reminders[0]!.relativePeriod).toBe(-3600);
      expect(reminders[0]!.relativeTo).toBe('due_date');
    });

    it('skips rows with no time and no relative spec', async () => {
      await seedProjectAndTask();
      await replaceTaskRemindersFromServer('task1', [
        { reminder: null as any, relative_period: null as any, relative_to: null as any },
      ] as any);
      expect(await listRemindersForTask('task1')).toEqual([]);
    });
  });

  describe('listRemindersForTask', () => {
    it('returns empty for a task with no reminders', async () => {
      await seedProjectAndTask();
      expect(await listRemindersForTask('task1')).toEqual([]);
    });
  });

  describe('listUnnotifiedReminders', () => {
    it('returns unnotified reminders for non-done, non-deleted tasks', async () => {
      await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_reminders (task_local_id, reminder_at, notified) VALUES (?, ?, 0)`,
        ['task1', '2026-06-01T00:00:00Z'],
      );
      await db.execute(
        `INSERT INTO task_reminders (task_local_id, reminder_at, notified) VALUES (?, ?, 1)`,
        ['task1', '2026-07-01T00:00:00Z'],
      );
      const due = await listUnnotifiedReminders();
      expect(due.map((d) => d.reminderAt)).toEqual(['2026-06-01T00:00:00Z']);
    });

    it('excludes reminders for done tasks', async () => {
      await seedProjectAndTask();
      const db = await getDb();
      await db.execute(`UPDATE tasks SET done = 1 WHERE local_id = ?`, ['task1']);
      await db.execute(
        `INSERT INTO task_reminders (task_local_id, reminder_at, notified) VALUES (?, ?, 0)`,
        ['task1', '2026-06-01T00:00:00Z'],
      );
      expect(await listUnnotifiedReminders()).toEqual([]);
    });

    it('excludes reminders with NULL reminder_at', async () => {
      await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_reminders (task_local_id, reminder_at, relative_period, relative_to, notified) VALUES (?, NULL, -3600, 'due_date', 0)`,
        ['task1'],
      );
      expect(await listUnnotifiedReminders()).toEqual([]);
    });
  });

  describe('markReminderNotified', () => {
    it('sets notified = 1 for the matching row', async () => {
      await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_reminders (task_local_id, reminder_at, notified) VALUES (?, ?, 0)`,
        ['task1', '2026-06-01T00:00:00Z'],
      );
      await markReminderNotified('task1', '2026-06-01T00:00:00Z');
      const row = await db.select<{ notified: number }[]>(
        `SELECT notified FROM task_reminders WHERE task_local_id = ? AND reminder_at = ?`,
        ['task1', '2026-06-01T00:00:00Z'],
      );
      expect(row[0]!.notified).toBe(1);
    });
  });

  describe('addReminder', () => {
    it('adds an absolute reminder and marks the task dirty', async () => {
      await seedProjectAndTask();
      await addReminder('task1', { at: '2026-08-01T00:00:00Z' });
      const reminders = await listRemindersForTask('task1');
      expect(reminders.map((r) => r.reminderAt)).toEqual(['2026-08-01T00:00:00Z']);
      const db = await getDb();
      const task = await db.select<{ dirty: number }[]>(
        `SELECT dirty FROM tasks WHERE local_id = ?`,
        ['task1'],
      );
      expect(task[0]!.dirty).toBe(1);
    });

    it('resolves relative reminder from due_date', async () => {
      await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `UPDATE tasks SET due_date = ? WHERE local_id = ?`,
        ['2026-06-10T00:00:00Z', 'task1'],
      );
      await addReminder('task1', { period: -3600, relativeTo: 'due_date' });
      const reminders = await listRemindersForTask('task1');
      // due_date 2026-06-10T00:00:00Z minus 3600s = 2026-06-09T23:00:00Z
      expect(reminders[0]!.reminderAt).toBe('2026-06-09T23:00:00.000Z');
      expect(reminders[0]!.relativePeriod).toBe(-3600);
      expect(reminders[0]!.relativeTo).toBe('due_date');
    });

    it('stores relative reminder with NULL reminder_at when task has no date', async () => {
      await seedProjectAndTask();
      await addReminder('task1', { period: -3600, relativeTo: 'due_date' });
      const reminders = await listRemindersForTask('task1');
      expect(reminders[0]!.reminderAt).toBeNull();
      expect(reminders[0]!.relativePeriod).toBe(-3600);
    });

    it('is idempotent for duplicate reminder specs', async () => {
      await seedProjectAndTask();
      await addReminder('task1', { at: '2026-09-01T00:00:00Z' });
      await addReminder('task1', { at: '2026-09-01T00:00:00Z' });
      const reminders = await listRemindersForTask('task1');
      expect(reminders).toHaveLength(1);
    });
  });

  describe('removeReminder', () => {
    it('removes an absolute reminder by at', async () => {
      await seedProjectAndTask();
      await addReminder('task1', { at: '2026-10-01T00:00:00Z' });
      await addReminder('task1', { at: '2026-11-01T00:00:00Z' });
      await removeReminder('task1', { at: '2026-10-01T00:00:00Z' });
      const reminders = await listRemindersForTask('task1');
      expect(reminders.map((r) => r.reminderAt)).toEqual(['2026-11-01T00:00:00Z']);
    });

    it('removes a relative reminder by period+relativeTo', async () => {
      await seedProjectAndTask();
      await addReminder('task1', { period: -3600, relativeTo: 'due_date' });
      await removeReminder('task1', { period: -3600, relativeTo: 'due_date' });
      expect(await listRemindersForTask('task1')).toEqual([]);
    });
  });
});
