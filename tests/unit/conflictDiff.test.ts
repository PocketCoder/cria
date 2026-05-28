// Coverage for diffConflict / renderValue (src/db/conflicts.ts) — the
// field-by-field diff the conflict modal renders. Pure function (JSON in,
// display strings out), no DB needed. Added alongside the #34 fix that
// makes ISO timestamps human-readable.

import { describe, it, expect } from 'vitest';
import { diffConflict } from '@/db/conflicts';

const fields = (...f: string[]) => JSON.stringify(f);
const snap = (o: Record<string, unknown>) => JSON.stringify(o);

describe('diffConflict', () => {
  it('formats ISO datetimes instead of dumping the raw string (#34)', () => {
    const diffs = diffConflict(
      fields('due_date'),
      snap({ due_date: '2026-05-21T01:00:00+01:00' }),
      snap({ due_date: '2026-05-28T01:00:00+01:00' }),
    );
    const d = diffs[0]!;
    expect(d.label).toBe('Due date');
    // No raw ISO marker, and the human month/year survives (TZ-stable
    // for these values — the day may shift by zone but May 2026 won't).
    expect(d.local).not.toContain('T01:00:00');
    expect(d.local).toContain('May 2026');
    expect(d.remote).toContain('May 2026');
  });

  it('maps the Vikunja "no date" sentinel to —', () => {
    const diffs = diffConflict(
      fields('due_date'),
      snap({ due_date: '0001-01-01T00:00:00Z' }),
      snap({ due_date: '2026-05-28T01:00:00+01:00' }),
    );
    expect(diffs[0]!.local).toBe('—');
  });

  it('renders booleans as yes/no and uses the field label', () => {
    const diffs = diffConflict(
      fields('done'),
      snap({ done: true }),
      snap({ done: false }),
    );
    const d = diffs[0]!;
    expect(d.label).toBe('Done');
    expect(d.local).toBe('yes');
    expect(d.remote).toBe('no');
  });

  it('passes plain strings through and falls back to the raw field name', () => {
    const diffs = diffConflict(
      fields('title'),
      snap({ title: 'Fix grill' }),
      snap({ title: 'Fix oven grill' }),
    );
    expect(diffs[0]!.local).toBe('Fix grill');
    expect(diffs[0]!.remote).toBe('Fix oven grill');
  });

  it('returns no rows when the snapshots are garbled', () => {
    expect(diffConflict(fields('title'), '{bad', '{also bad')).toEqual([
      { field: 'title', label: 'Title', local: '—', remote: '—' },
    ]);
  });
});
