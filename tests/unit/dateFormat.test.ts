// Coverage for src/lib/dateFormat.ts — the preference-aware date/time
// formatter that backs reminders, conflict timestamps and the date picker.
// The plain (non-React) variants read the settings store at call time, so we
// drive them by mutating the store and asserting the rendered string.

import { describe, it, expect, beforeEach } from 'vitest';
import { useSettings } from '@/stores/settings';
import { formatDate, formatDateTime, formatTime } from '@/lib/dateFormat';

// Local-time construction (no UTC) so the assertions are timezone-stable:
// the formatter renders in local time and we build from local components.
const d = new Date(2026, 5, 9, 14, 30); // 9 Jun 2026, 14:30 local

describe('dateFormat', () => {
  beforeEach(() => {
    useSettings.setState({ dateFormat: 'YYYY-MM-DD', timeFormat: '24h' });
  });

  it('renders the date in the YYYY-MM-DD preference', () => {
    expect(formatDate(d)).toBe('2026-06-09');
  });

  it('renders the date in the MM/DD/YYYY preference', () => {
    useSettings.setState({ dateFormat: 'MM/DD/YYYY' });
    expect(formatDate(d)).toBe('06/09/2026');
  });

  it('renders the date in the DD/MM/YYYY preference', () => {
    useSettings.setState({ dateFormat: 'DD/MM/YYYY' });
    expect(formatDate(d)).toBe('09/06/2026');
  });

  it('renders time as 24h or 12h per preference', () => {
    expect(formatTime(d)).toBe('14:30');
    useSettings.setState({ timeFormat: '12h' });
    expect(formatTime(d)).toBe('2:30 PM');
  });

  it('combines date and time honouring both preferences', () => {
    expect(formatDateTime(d)).toBe('2026-06-09, 14:30');
    useSettings.setState({ dateFormat: 'DD/MM/YYYY', timeFormat: '12h' });
    expect(formatDateTime(d)).toBe('09/06/2026, 2:30 PM');
  });

  it('accepts ISO strings as well as Date objects', () => {
    expect(formatDate('2026-01-02T08:00:00')).toBe('2026-01-02');
  });
});
