// Coverage for src/sync/push.ts::taskToBody.
//
// Every quirk listed below caused a production bug at some point —
// they're documented in CLAUDE.md's "Recent work (Deepseek V4 Pro)"
// block. The function is pure (TaskRow → request body), so testing it
// directly is the cheap way to pin the wire format.

import { describe, it, expect } from 'vitest';
import { taskToBody, type TaskRow } from '@/sync/push';

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    local_id: 'tsk_x',
    server_id: 1,
    project_local_id: 'proj_x',
    title: 'A task',
    description: null,
    done: 0,
    done_at: null,
    due_date: null,
    start_date: null,
    end_date: null,
    priority: 0,
    percent_done: 0,
    hex_color: null,
    is_favorite: 0,
    repeat_after: 0,
    repeat_mode: 0,
    deleted: 0,
    ...over,
  };
}

describe('taskToBody', () => {
  it('strips the leading # from hex_color (Vikunja 500-errors on the prefix)', () => {
    expect(taskToBody(row({ hex_color: '#ff0000' })).hex_color).toBe('ff0000');
  });

  it('keeps hex_color as-is when no # prefix is present', () => {
    expect(taskToBody(row({ hex_color: 'aabbcc' })).hex_color).toBe('aabbcc');
  });

  it('emits hex_color undefined for null or empty input (server clears the field)', () => {
    expect(taskToBody(row({ hex_color: null })).hex_color).toBeUndefined();
    expect(taskToBody(row({ hex_color: '' })).hex_color).toBeUndefined();
  });

  it('scales percent_done from 0–1 to 0–100 (UI stored 0-1, server expects 0-100)', () => {
    expect(taskToBody(row({ percent_done: 0.5 })).percent_done).toBe(50);
    expect(taskToBody(row({ percent_done: 0.33 })).percent_done).toBe(33);
    expect(taskToBody(row({ percent_done: 1 })).percent_done).toBe(100);
  });

  it('passes percent_done through unchanged when already in 0-100 range', () => {
    expect(taskToBody(row({ percent_done: 75 })).percent_done).toBe(75);
    expect(taskToBody(row({ percent_done: 100 })).percent_done).toBe(100);
  });

  it('sends is_favorite as explicit false (not omitted — un-favorite was broken before)', () => {
    const body = taskToBody(row({ is_favorite: 0 }));
    expect(body.is_favorite).toBe(false);
    expect('is_favorite' in body).toBe(true);
  });

  it('sends is_favorite as explicit true when set', () => {
    expect(taskToBody(row({ is_favorite: 1 })).is_favorite).toBe(true);
  });

  it('includes project_id only when a projectServerId is supplied (move case)', () => {
    expect('project_id' in taskToBody(row())).toBe(false);
    expect(taskToBody(row(), 42).project_id).toBe(42);
  });

  it('coerces done to a real boolean', () => {
    expect(taskToBody(row({ done: 1 })).done).toBe(true);
    expect(taskToBody(row({ done: 0 })).done).toBe(false);
  });

  it('omits description when null', () => {
    expect(taskToBody(row({ description: null })).description).toBeUndefined();
  });

  it('passes description through when set', () => {
    expect(taskToBody(row({ description: '<p>hello</p>' })).description).toBe('<p>hello</p>');
  });

  describe('date fields', () => {
    it('emits due_date as undefined when null', () => {
      expect(taskToBody(row({ due_date: null })).due_date).toBeUndefined();
    });

    it('passes full ISO due_date through unchanged', () => {
      expect(taskToBody(row({ due_date: '2026-06-09T12:00:00+01:00' })).due_date).toBe('2026-06-09T12:00:00+01:00');
    });

    it('converts date-only due_date to local ISO datetime', () => {
      const body = taskToBody(row({ due_date: '2026-06-09' }));
      expect(body.due_date).toMatch(/^2026-06-09T00:00:00[+-]\d{2}:\d{2}$/);
    });

    it('converts date-only start_date to local ISO datetime', () => {
      const body = taskToBody(row({ start_date: '2026-07-04' }));
      expect(body.start_date).toMatch(/^2026-07-04T00:00:00[+-]\d{2}:\d{2}$/);
    });

    it('converts date-only end_date to local ISO datetime', () => {
      const body = taskToBody(row({ end_date: '2026-08-15' }));
      expect(body.end_date).toMatch(/^2026-08-15T00:00:00[+-]\d{2}:\d{2}$/);
    });

    it('omits start_date and end_date when null', () => {
      const body = taskToBody(row({ start_date: null, end_date: null }));
      expect(body.start_date).toBeUndefined();
      expect(body.end_date).toBeUndefined();
    });
  });
});
