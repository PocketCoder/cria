/**
 * Whether a task repeats at all. Monthly mode (`repeatMode` 1) ignores
 * `repeatAfter` on the server and quick-add leaves it at 0, so checking the
 * interval alone misses it.
 */
export function isRepeating(repeatAfter: number | null, repeatMode: number | null): boolean {
  return repeatMode === 1 || (repeatAfter ?? 0) > 0;
}

/** Human label for a task's recurrence (monthly mode, or an interval in seconds). */
export function repeatLabel(repeatAfter: number | null, repeatMode: number | null): string {
  if (repeatMode === 1) return 'Monthly';
  if (repeatAfter === null) return '';
  const HOUR = 3600;
  const DAY = 86400;
  const WEEK = 604800;
  const YEAR = 31536000;
  if (repeatAfter % YEAR === 0 && repeatAfter >= YEAR) {
    const n = repeatAfter / YEAR;
    return n === 1 ? 'Yearly' : `Every ${n} years`;
  }
  if (repeatAfter % WEEK === 0 && repeatAfter >= WEEK) {
    const n = repeatAfter / WEEK;
    return n === 1 ? 'Weekly' : `Every ${n} weeks`;
  }
  if (repeatAfter % DAY === 0 && repeatAfter >= DAY) {
    const n = repeatAfter / DAY;
    return n === 1 ? 'Daily' : `Every ${n} days`;
  }
  if (repeatAfter % HOUR === 0 && repeatAfter >= HOUR) {
    const n = repeatAfter / HOUR;
    return n === 1 ? 'Hourly' : `Every ${n} hours`;
  }
  return `Every ${repeatAfter}s`;
}
