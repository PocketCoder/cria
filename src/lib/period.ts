/**
 * Convert seconds to/from a human-readable period (amount + unit).
 *
 * Ported from Vikunja-web's `frontend/src/helpers/time/period.ts` so
 * relative reminders render identically to what the web client shows.
 * We keep the same unit set — minutes, hours, days, weeks — and skip
 * months/years (which aren't a clean multiple of SECONDS_A_DAY) and
 * seconds (no reminder picker exposes sub-minute granularity).
 */

export type PeriodUnit = 'minutes' | 'hours' | 'days' | 'weeks';

const SECONDS_A_MINUTE = 60;
const SECONDS_A_HOUR = 60 * 60;
const SECONDS_A_DAY = 24 * SECONDS_A_HOUR;
const SECONDS_A_WEEK = 7 * SECONDS_A_DAY;

/**
 * Choose the largest unit that divides `seconds` cleanly. Mirrors
 * Vikunja-web's preference order: weeks → days → hours → minutes.
 * Negative inputs work — the sign moves to `amount`.
 */
export function secondsToPeriod(seconds: number): { amount: number; unit: PeriodUnit } {
  const abs = Math.abs(seconds);
  if (abs === 0) return { amount: 0, unit: 'minutes' };

  if (abs % SECONDS_A_WEEK === 0) {
    return { amount: seconds / SECONDS_A_WEEK, unit: 'weeks' };
  }
  if (abs % SECONDS_A_DAY === 0) {
    return { amount: seconds / SECONDS_A_DAY, unit: 'days' };
  }
  if (abs % SECONDS_A_HOUR === 0) {
    return { amount: seconds / SECONDS_A_HOUR, unit: 'hours' };
  }
  return { amount: seconds / SECONDS_A_MINUTE, unit: 'minutes' };
}

export function periodToSeconds(amount: number, unit: PeriodUnit): number {
  switch (unit) {
    case 'minutes': return amount * SECONDS_A_MINUTE;
    case 'hours':   return amount * SECONDS_A_HOUR;
    case 'days':    return amount * SECONDS_A_DAY;
    case 'weeks':   return amount * SECONDS_A_WEEK;
  }
}

export type ReminderRelation = 'due_date' | 'start_date' | 'end_date';

/**
 * Human-readable label for a relative reminder. Matches Vikunja-web's
 * format so cross-client display agrees:
 *   - `{amount: 0}` → "On due date" / "On start date" / "On end date"
 *   - negative period → "{n} {unit} before {field}"
 *   - positive period → "{n} {unit} after {field}"
 */
export function formatRelativeReminder(
  periodSeconds: number,
  relativeTo: ReminderRelation,
): string {
  const fieldLabel = relativeTo === 'due_date'
    ? 'due date'
    : relativeTo === 'start_date'
      ? 'start date'
      : 'end date';

  const { amount, unit } = secondsToPeriod(periodSeconds);
  if (amount === 0) return `On ${fieldLabel}`;

  const abs = Math.abs(amount);
  const unitLabel = unit === 'minutes'
    ? abs === 1 ? 'minute' : 'minutes'
    : unit === 'hours'
      ? abs === 1 ? 'hour' : 'hours'
      : unit === 'days'
        ? abs === 1 ? 'day' : 'days'
        : abs === 1 ? 'week' : 'weeks';

  return periodSeconds < 0
    ? `${abs} ${unitLabel} before ${fieldLabel}`
    : `${abs} ${unitLabel} after ${fieldLabel}`;
}

/**
 * Preset offsets exposed as one-click chips. Matches Vikunja-web's
 * `presets` computed in ReminderDetail.vue. All default to due_date;
 * the picker UI lets the user change the relation per preset.
 */
export const RELATIVE_REMINDER_PRESETS: readonly { label: string; seconds: number }[] = [
  { label: 'On',          seconds: 0 },
  { label: '2h before',   seconds: -2 * SECONDS_A_HOUR },
  { label: '1d before',   seconds: -1 * SECONDS_A_DAY },
  { label: '3d before',   seconds: -3 * SECONDS_A_DAY },
  { label: '1w before',   seconds: -1 * SECONDS_A_WEEK },
  { label: '30d before',  seconds: -30 * SECONDS_A_DAY },
];
