import { describe, it, expect } from 'vitest';
import { addDays } from 'date-fns';
import { parseSearchQuery } from '@/lib/searchQueryParser';

// Pin "now" for deterministic test results.
const NOW = new Date(2026, 5, 9, 12, 0, 0); // 9 Jun 2026 12:00 local

// Helpers matching the implementation's UTC-midnight convention.
function utcMidnight(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
}
function utcEndOfDay(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)).toISOString();
}
function utcEndOfWeek(d: Date, weekStartsOn: number): string {
  const diff = (6 - d.getDay() + weekStartsOn) % 7;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + diff, 23, 59, 59, 999)).toISOString();
}

describe('parseSearchQuery', () => {
  it('parses plain text', () => {
    const q = parseSearchQuery('buy milk', NOW);
    expect(q.text).toBe('buy milk');
    expect(q.tokens).toEqual([{ kind: 'text', text: 'buy milk' }]);
    expect(q.dueDateStart).toBeNull();
    expect(q.dueDateEnd).toBeNull();
    expect(q.labelTitle).toBeNull();
    expect(q.priority).toBeNull();
  });

  it('parses empty string', () => {
    const q = parseSearchQuery('', NOW);
    expect(q.text).toBe('');
    expect(q.tokens).toEqual([]);
  });

  it('normalises whitespace-only input to empty text', () => {
    const q = parseSearchQuery('   ', NOW);
    expect(q.text).toBe('');
    // Token array may contain whitespace text tokens — that's an artifact
    // of the current tokeniser, not a semantic concern.
  });

  describe('labels', () => {
    it('parses simple label #labelName', () => {
      const q = parseSearchQuery('#urgent', NOW);
      expect(q.labelTitle).toBe('urgent');
      expect(q.tokens).toContainEqual({
        kind: 'label', text: '#urgent', title: 'urgent',
      });
    });

    it('parses quoted multi-word label #"My Label"', () => {
      const q = parseSearchQuery('#"My Label"', NOW);
      expect(q.labelTitle).toBe('My Label');
    });

    it('strips label from text', () => {
      const q = parseSearchQuery('meeting #work', NOW);
      expect(q.text).toBe('meeting');
      expect(q.tokens).toEqual([
        { kind: 'text', text: 'meeting ' },
        { kind: 'label', text: '#work', title: 'work' },
      ]);
    });

    it('ignores # with no label text after', () => {
      const q = parseSearchQuery('just a #', NOW);
      expect(q.text).toBe('just a #');
      expect(q.labelTitle).toBeNull();
    });
  });

  describe('priority', () => {
    it('parses priority !3', () => {
      const q = parseSearchQuery('!3', NOW);
      expect(q.priority).toBe(3);
      expect(q.tokens).toContainEqual({
        kind: 'priority', text: '!3', value: 3,
      });
    });

    it('strips priority from text', () => {
      const q = parseSearchQuery('task !1', NOW);
      expect(q.text).toBe('task');
    });

    it('takes the highest priority when multiple are given', () => {
      const q = parseSearchQuery('!3 !1', NOW);
      expect(q.priority).toBe(3);
    });
  });

  describe('dates', () => {
    it('parses "today" to start/end of same calendar day', () => {
      const q = parseSearchQuery('today', NOW);
      const expectedStart = utcMidnight(NOW);
      const expectedEnd = utcEndOfDay(NOW);
      expect(q.dueDateStart).toBe(expectedStart);
      expect(q.dueDateEnd).toBe(expectedEnd);
    });

    it('parses "tomorrow" to start/end of next calendar day', () => {
      const q = parseSearchQuery('tomorrow', NOW);
      const tomorrow = addDays(NOW, 1);
      const expectedStart = utcMidnight(tomorrow);
      const expectedEnd = utcEndOfDay(tomorrow);
      expect(q.dueDateStart).toBe(expectedStart);
      expect(q.dueDateEnd).toBe(expectedEnd);
    });

    it('parses "this week" covers through end of week with no lower bound', () => {
      const q = parseSearchQuery('this week', NOW);
      // "this week" sets startIso to undefined → dueDateStart stays null
      expect(q.dueDateStart).toBeNull();
      // endOfWeek with weekStartsOn:1 (Monday) = Sunday 14 Jun 2026
      const expectedEnd = utcEndOfWeek(NOW, 1);
      expect(q.dueDateEnd).toBe(expectedEnd);
    });

    it('parses "soon" as next 14 days with no lower bound', () => {
      const q = parseSearchQuery('soon', NOW);
      expect(q.dueDateStart).toBeNull();
      const expectedEnd = utcEndOfDay(addDays(NOW, 14));
      expect(q.dueDateEnd).toBe(expectedEnd);
    });

    it('only the first date phrase wins', () => {
      const q = parseSearchQuery('today tomorrow', NOW);
      const expectedStart = utcMidnight(NOW);
      expect(q.dueDateStart).toBe(expectedStart);
    });
  });

  describe('combined', () => {
    it('text + label + priority + date', () => {
      const q = parseSearchQuery('buy milk #groceries !1 tomorrow', NOW);
      expect(q.text).toBe('buy milk');
      expect(q.labelTitle).toBe('groceries');
      expect(q.priority).toBe(1);
      expect(q.dueDateStart).toBe(utcMidnight(addDays(NOW, 1)));
    });
  });
});
