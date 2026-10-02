import { describe, expect, it } from 'vitest';
import { indicatorStyle } from '@/components/ui/segmentIndicator';

describe('indicatorStyle', () => {
  const box = { x: 12, y: 2, w: 80, h: 24 };

  it('positions the indicator over the box', () => {
    const s = indicatorStyle(box, true);
    expect(s).toMatchObject({ left: 0, top: 2, width: 80, height: 24, transform: 'translateX(12px)' });
  });

  it('does not animate until the first move', () => {
    expect(indicatorStyle(box, false).transition).toBe('none');
    expect(indicatorStyle(box, true).transition).toContain('transform var(--duration-slide)');
  });

  it('appends an extra transition when given one', () => {
    expect(indicatorStyle(box, true, 'opacity 1s').transition).toMatch(/, opacity 1s$/);
    expect(indicatorStyle(box, false, 'opacity 1s').transition).toBe('none');
  });
});
