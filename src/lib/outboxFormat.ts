import type { OutboxRow, DeadLetterRow } from '@/queries/outboxRows';

/** One row → a plain-text block for the clipboard. */
export function rowToText(row: OutboxRow | DeadLetterRow): string {
  const when =
    'failed_at' in row && row.failed_at ? ` failed=${row.failed_at}` : '';
  return [
    `#${row.id} ${row.entity_type}·${row.op} attempts=${row.attempts}${when}`,
    `  error: ${row.last_error ?? '(none)'}`,
    `  payload: ${row.payload}`,
  ].join('\n');
}

/** Pretty-print JSON if we can; otherwise show the raw payload. Never throws. */
export function safeFormatJson(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

/** `YYYY-MM-DD HH:MM:SS` for a dead letter's failure time, or null. */
export function formatFailedAt(row: OutboxRow | DeadLetterRow): string | null {
  return 'failed_at' in row && row.failed_at
    ? row.failed_at.slice(0, 19).replace('T', ' ')
    : null;
}
