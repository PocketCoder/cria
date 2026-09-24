import { describe, it, expect } from 'vitest';
import { parseNotification } from '@/lib/notificationParse';

// Fixture payloads mirror upstream pkg/models/notifications.go ToDB() structs.
const doer = { id: 9, username: 'alice', name: 'Alice' };
const task = { id: 42, title: 'Buy milk', identifier: 'HOME-3' };

describe('parseNotification', () => {
  it('task.assigned', () => {
    const p = parseNotification('task.assigned', {
      doer,
      task,
      assignee: { id: 2, username: 'bob' },
    });
    expect(p.text).toContain('Alice');
    expect(p.text.toLowerCase()).toContain('assigned');
    expect(p.text).toContain('Buy milk');
    expect(p.taskServerId).toBe(42);
  });

  it('task.comment (plain)', () => {
    const p = parseNotification('task.comment', { doer, task, mentioned: false });
    expect(p.text).toContain('Alice');
    expect(p.text.toLowerCase()).toContain('comment');
    expect(p.taskServerId).toBe(42);
  });

  it('task.comment (mention flavor)', () => {
    const p = parseNotification('task.comment', { doer, task, mentioned: true });
    expect(p.text.toLowerCase()).toContain('mentioned');
  });

  it('task.mentioned', () => {
    const p = parseNotification('task.mentioned', { doer, task });
    expect(p.text.toLowerCase()).toContain('mentioned');
    expect(p.taskServerId).toBe(42);
  });

  it('task.deleted', () => {
    const p = parseNotification('task.deleted', { doer, task });
    expect(p.text.toLowerCase()).toContain('deleted');
    // Deleted task can't be opened.
    expect(p.taskServerId).toBeNull();
  });

  it('team.member.added', () => {
    const p = parseNotification('team.member.added', {
      doer,
      member: { id: 2, username: 'bob', name: '' },
      team: { id: 1, name: 'Family' },
    });
    expect(p.text).toContain('Family');
    expect(p.taskServerId).toBeNull();
  });

  it('task.reminder', () => {
    const p = parseNotification('task.reminder', { task, project: { id: 1, title: 'Home' } });
    expect(p.text).toContain('Buy milk');
    expect(p.taskServerId).toBe(42);
  });

  it('unknown names fall back to the raw name and never throw', () => {
    const p = parseNotification('something.new', { whatever: true });
    expect(p.text).toBe('something.new');
    expect(p.taskServerId).toBeNull();
  });

  it('handles garbage payloads without throwing', () => {
    expect(() => parseNotification('task.assigned', null)).not.toThrow();
    expect(() => parseNotification('task.comment', 'nonsense')).not.toThrow();
    expect(parseNotification('task.assigned', null).text).toBeTruthy();
  });
});
