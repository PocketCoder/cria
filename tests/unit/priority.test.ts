import { describe, expect, it } from 'vitest';
import { PRIORITY_LABELS, PRIORITY_META, priorityColor } from '@/components/ui/priority';

describe('priority scale', () => {
  it('covers levels 0 to 5 in order', () => {
    expect(PRIORITY_META.map((m) => m.value)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(PRIORITY_LABELS).toEqual(['None', 'Low', 'Medium', 'High', 'Urgent', 'Critical']);
  });

  it('returns a token colour for every level except none', () => {
    expect(priorityColor(0)).toBe('transparent');
    expect(priorityColor(2)).toBe('var(--prio-medium)');
    expect(priorityColor(3)).toBe('var(--prio-high)');
    expect(priorityColor(5)).toBe('var(--prio-critical)');
  });

  it('falls back to the None colour for out-of-range values', () => {
    expect(priorityColor(99)).toBe('transparent');
    expect(priorityColor(-1)).toBe('transparent');
  });
});
