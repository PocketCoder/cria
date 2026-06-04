import { describe, it, expect } from 'vitest';
import { taskResponseSchema, relatedTaskSchema, taskReminderSchema, taskAttachmentSchema, normaliseDate, inverseRelationKind } from '@/domain/task';
import { projectResponseSchema } from '@/domain/project';
import { labelResponseSchema } from '@/domain/label';
import { userResponseSchema, userFromResponse } from '@/domain/user';
import { assigneeResponseSchema } from '@/domain/task-assignee';

// ---------------------------------------------------------------------------
// task.ts
// ---------------------------------------------------------------------------
describe('taskResponseSchema', () => {
  it('parses a full server response', () => {
    const r = taskResponseSchema.safeParse({
      id: 42,
      project_id: 7,
      title: 'Buy milk',
      description: 'Need 2%',
      done: true,
      done_at: '2026-06-09T10:00:00Z',
      due_date: '2026-06-10T00:00:00Z',
      start_date: '2026-06-08T00:00:00Z',
      end_date: '2026-06-11T00:00:00Z',
      priority: 3,
      percent_done: 0.5,
      hex_color: '#ff0000',
      position: 1,
      updated: '2026-06-09T10:00:00Z',
      created: '2026-06-01T00:00:00Z',
      is_favorite: true,
      repeat_after: 86400,
      repeat_mode: 1,
      identifier: 'PROJ-42',
      labels: [],
      assignees: [],
      attachments: [],
      reminders: [],
      related_tasks: {},
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.id).toBe(42);
      expect(r.data.title).toBe('Buy milk');
      expect(r.data.done).toBe(true);
      expect(r.data.is_favorite).toBe(true);
    }
  });

  it('parses a minimal response (only required fields)', () => {
    const r = taskResponseSchema.safeParse({ id: 1, project_id: 2, title: 'x' });
    expect(r.success).toBe(true);
  });

  it('accepts nullable optionals', () => {
    const r = taskResponseSchema.safeParse({
      id: 1, project_id: 2, title: 'x',
      description: null, due_date: null, priority: null,
      percent_done: null, hex_color: null, position: null,
      updated: null, is_favorite: null, repeat_after: null,
      repeat_mode: null,
    });
    expect(r.success).toBe(true);
  });

  it('accepts unknown extra fields (passthrough)', () => {
    const r = taskResponseSchema.safeParse({
      id: 1, project_id: 2, title: 'x', extra_field: 'ignored',
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-numeric id', () => {
    expect(taskResponseSchema.safeParse({ id: 'abc', project_id: 2, title: 'x' }).success).toBe(false);
  });

  it('rejects non-string title', () => {
    expect(taskResponseSchema.safeParse({ id: 1, project_id: 2, title: 42 }).success).toBe(false);
  });
});

describe('relatedTaskSchema', () => {
  it('parses a full related task', () => {
    const r = relatedTaskSchema.safeParse({ id: 42, title: 'Parent', done: false, project_id: 7 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.id).toBe(42);
  });

  it('parses minimal (id only)', () => {
    expect(relatedTaskSchema.safeParse({ id: 1 }).success).toBe(true);
  });
});

describe('taskReminderSchema', () => {
  it('parses a reminder', () => {
    const r = taskReminderSchema.safeParse({ reminder: '2026-06-10T00:00:00Z', relative_period: 3600, relative_to: 'due_date' });
    expect(r.success).toBe(true);
  });

  it('parses a reminder with null fields', () => {
    expect(taskReminderSchema.safeParse({ reminder: null, relative_period: null, relative_to: null }).success).toBe(true);
  });
});

describe('taskAttachmentSchema', () => {
  it('parses a full attachment', () => {
    const r = taskAttachmentSchema.safeParse({
      id: 99,
      task_id: 42,
      created: '2026-06-01T00:00:00Z',
      file: { id: 1, name: 'photo.png', size: 1024, mime: 'image/png' },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.id).toBe(99);
  });

  it('parses minimal (id only)', () => {
    expect(taskAttachmentSchema.safeParse({ id: 99 }).success).toBe(true);
  });
});

describe('normaliseDate', () => {
  it('returns null for null', () => {
    expect(normaliseDate(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normaliseDate(undefined)).toBeNull();
  });

  it('maps the Vikunja zero-date sentinel to null', () => {
    expect(normaliseDate('0001-01-01T00:00:00Z')).toBeNull();
  });

  it('passes through a normal date string', () => {
    expect(normaliseDate('2026-06-09T10:00:00Z')).toBe('2026-06-09T10:00:00Z');
  });
});

describe('inverseRelationKind', () => {
  const pairs: [string, string][] = [
    ['subtask', 'parenttask'],
    ['parenttask', 'subtask'],
    ['related', 'related'],
    ['duplicates', 'duplicateof'],
    ['duplicateof', 'duplicates'],
    ['blocking', 'blocked'],
    ['blocked', 'blocking'],
    ['precedes', 'follows'],
    ['follows', 'precedes'],
    ['copiedfrom', 'copiedto'],
    ['copiedto', 'copiedfrom'],
  ];
  for (const [kind, expected] of pairs) {
    it(`${kind} → ${expected}`, () => {
      expect(inverseRelationKind(kind as any)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// project.ts
// ---------------------------------------------------------------------------
describe('projectResponseSchema', () => {
  it('parses a full project response', () => {
    const r = projectResponseSchema.safeParse({
      id: 7,
      title: 'Work',
      description: 'Office tasks',
      parent_project_id: 3,
      hex_color: '#00ff00',
      is_archived: false,
      is_favorite: true,
      position: 0,
      updated: '2026-06-09T10:00:00Z',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.id).toBe(7);
  });

  it('parses minimal (id + title only)', () => {
    expect(projectResponseSchema.safeParse({ id: 1, title: 'x' }).success).toBe(true);
  });

  it('rejects missing id', () => {
    expect(projectResponseSchema.safeParse({ title: 'x' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// label.ts
// ---------------------------------------------------------------------------
describe('labelResponseSchema', () => {
  it('parses a full label response', () => {
    const r = labelResponseSchema.safeParse({
      id: 12,
      title: 'urgent',
      description: 'High priority items',
      hex_color: '#ff0000',
      updated: '2026-06-09T10:00:00Z',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.id).toBe(12);
  });

  it('parses minimal (id + title only)', () => {
    expect(labelResponseSchema.safeParse({ id: 1, title: 'x' }).success).toBe(true);
  });

  it('rejects missing title', () => {
    expect(labelResponseSchema.safeParse({ id: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// user.ts
// ---------------------------------------------------------------------------
describe('userResponseSchema', () => {
  it('parses a full user response', () => {
    const r = userResponseSchema.safeParse({
      id: 1,
      username: 'jake',
      email: 'jake@example.com',
      name: 'Jake',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.id).toBe(1);
  });

  it('parses minimal (id + username only)', () => {
    expect(userResponseSchema.safeParse({ id: 1, username: 'jake' }).success).toBe(true);
  });

  it('rejects missing id', () => {
    expect(userResponseSchema.safeParse({ username: 'jake' }).success).toBe(false);
  });
});

describe('userFromResponse', () => {
  it('transforms a full response with settings', () => {
    const u = userFromResponse({
      id: 1,
      username: 'jake',
      email: 'jake@example.com',
      name: 'Jake',
      settings: { default_project_id: 5, language: 'de', timezone: 'Europe/Berlin' },
    });
    expect(u.serverId).toBe(1);
    expect(u.username).toBe('jake');
    expect(u.email).toBe('jake@example.com');
    expect(u.name).toBe('Jake');
    expect(u.defaultProjectId).toBe(5);
    expect(u.language).toBe('de');
    expect(u.timezone).toBe('Europe/Berlin');
  });

  it('falls back to defaults when settings are missing', () => {
    const u = userFromResponse({ id: 1, username: 'jake' });
    expect(u.defaultProjectId).toBeNull();
    expect(u.language).toBe('en');
    expect(u.timezone).toBe('UTC');
  });
});

// ---------------------------------------------------------------------------
// task-assignee.ts
// ---------------------------------------------------------------------------
describe('assigneeResponseSchema', () => {
  it('parses a full assignee response', () => {
    const r = assigneeResponseSchema.safeParse({
      id: 42,
      username: 'alice',
      name: 'Alice',
      email: 'alice@example.com',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.id).toBe(42);
  });

  it('parses minimal (id only)', () => {
    expect(assigneeResponseSchema.safeParse({ id: 42 }).success).toBe(true);
  });

  it('rejects missing id', () => {
    expect(assigneeResponseSchema.safeParse({ username: 'alice' }).success).toBe(false);
  });
});
