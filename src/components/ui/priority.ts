/* Vikunja priority scale (0–5) with an ink-on-paper ramp: 0–2 carry no
   colour at all (the ledger renders nothing for them); High is the warm
   warning hue, Urgent a burnt orange, Critical the destructive red.
   `color` drives both the selected-segment fill and the unselected glyph
   tint. */
export interface PriorityMeta {
  value: number;
  label: string;
  color: string;
}

export const PRIORITY_META: readonly PriorityMeta[] = [
  { value: 0, label: 'None', color: 'transparent' },
  { value: 1, label: 'Low', color: 'transparent' },
  { value: 2, label: 'Medium', color: 'transparent' },
  // Tokens (not literals) so the ramp lifts in dark — see --prio-* in globals.css.
  { value: 3, label: 'High', color: 'var(--prio-high)' },
  { value: 4, label: 'Urgent', color: 'var(--prio-urgent)' },
  { value: 5, label: 'Critical', color: 'var(--prio-critical)' },
];

export const PRIORITY_LABELS = PRIORITY_META.map((m) => m.label);

export function priorityColor(value: number): string {
  return (PRIORITY_META[value] ?? PRIORITY_META[0]!).color;
}
