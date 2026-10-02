import { describe, expect, it } from 'vitest';
import type { DeadLetterRow, OutboxRow } from '@/queries/outboxRows';
import { formatFailedAt, rowToText, safeFormatJson } from '@/lib/outboxFormat';

const outbox = {
  id: 7,
  entity_type: 'task',
  op: 'update',
  attempts: 2,
  last_error: null,
  payload: '{"a":1}',
} as unknown as OutboxRow;

const dead = {
  ...outbox,
  last_error: 'boom',
  failed_at: '2030-01-02T03:04:05.678Z',
} as unknown as DeadLetterRow;

describe('safeFormatJson', () => {
  it('pretty prints valid JSON', () => {
    expect(safeFormatJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });
  it('returns invalid payloads unchanged', () => {
    expect(safeFormatJson('{oops')).toBe('{oops');
  });
});

describe('formatFailedAt', () => {
  it('is null for outbox rows', () => {
    expect(formatFailedAt(outbox)).toBeNull();
  });
  it('trims dead letter timestamps', () => {
    expect(formatFailedAt(dead)).toBe('2030-01-02 03:04:05');
  });
});

describe('rowToText', () => {
  it('describes an outbox row', () => {
    expect(rowToText(outbox)).toBe(
      '#7 task·update attempts=2\n  error: (none)\n  payload: {"a":1}',
    );
  });
  it('includes the failure time and error for dead letters', () => {
    expect(rowToText(dead)).toContain('failed=2030-01-02T03:04:05.678Z');
    expect(rowToText(dead)).toContain('error: boom');
  });
});
