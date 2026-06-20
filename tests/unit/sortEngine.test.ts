import { describe, it, expect } from 'vitest';
import { sortRuleToOrderBy, SORT_OPTIONS, type SortRule } from '@/lib/sortEngine';

describe('SORT_OPTIONS', () => {
  it('has 17 entries', () => {
    expect(SORT_OPTIONS).toHaveLength(17);
  });

  it('each option has label, field, and direction', () => {
    for (const opt of SORT_OPTIONS) {
      expect(opt.label).toBeTruthy();
      expect(['user_defined_order', 'percentDone', 'created', 'dueDate', 'endDate', 'priority', 'startDate', 'title', 'updated']).toContain(opt.field);
      expect(['asc', 'desc']).toContain(opt.direction);
    }
  });
});

describe('sortRuleToOrderBy', () => {
  it('returns empty string for null rule', () => {
    expect(sortRuleToOrderBy(null)).toBe('');
  });

  it('handles user_defined_order asc', () => {
    const r: SortRule = { field: 'user_defined_order', direction: 'asc' };
    expect(sortRuleToOrderBy(r)).toBe('COALESCE(position, 999999) ASC');
  });

  it('handles percentDone asc', () => {
    const r: SortRule = { field: 'percentDone', direction: 'asc' };
    expect(sortRuleToOrderBy(r)).toBe('percent_done ASC');
  });

  it('handles percentDone desc', () => {
    const r: SortRule = { field: 'percentDone', direction: 'desc' };
    expect(sortRuleToOrderBy(r)).toBe('percent_done DESC');
  });

  it('handles priority desc', () => {
    const r: SortRule = { field: 'priority', direction: 'desc' };
    expect(sortRuleToOrderBy(r)).toBe('priority DESC');
  });

  it('handles dueDate asc with nulls last', () => {
    const r: SortRule = { field: 'dueDate', direction: 'asc' };
    expect(sortRuleToOrderBy(r)).toBe('due_date IS NULL, due_date ASC');
  });

  it('handles dueDate desc with nulls last', () => {
    const r: SortRule = { field: 'dueDate', direction: 'desc' };
    expect(sortRuleToOrderBy(r)).toBe('due_date IS NULL, due_date DESC');
  });

  it('handles title asc with collation', () => {
    const r: SortRule = { field: 'title', direction: 'asc' };
    expect(sortRuleToOrderBy(r)).toBe('title ASC COLLATE NOCASE');
  });

  it('handles title desc without collation', () => {
    const r: SortRule = { field: 'title', direction: 'desc' };
    expect(sortRuleToOrderBy(r)).toBe('title DESC');
  });

  it('handles created desc with nulls last', () => {
    const r: SortRule = { field: 'created', direction: 'desc' };
    expect(sortRuleToOrderBy(r)).toBe('created_at IS NULL, created_at DESC');
  });

  it('handles created asc with nulls last', () => {
    const r: SortRule = { field: 'created', direction: 'asc' };
    expect(sortRuleToOrderBy(r)).toBe('created_at IS NULL, created_at ASC');
  });

  it('handles updated desc with nulls last', () => {
    const r: SortRule = { field: 'updated', direction: 'desc' };
    expect(sortRuleToOrderBy(r)).toBe('updated_at IS NULL, updated_at DESC');
  });

  it('handles startDate asc with nulls last', () => {
    const r: SortRule = { field: 'startDate', direction: 'asc' };
    expect(sortRuleToOrderBy(r)).toBe('start_date IS NULL, start_date ASC');
  });

  it('handles endDate desc with nulls last', () => {
    const r: SortRule = { field: 'endDate', direction: 'desc' };
    expect(sortRuleToOrderBy(r)).toBe('end_date IS NULL, end_date DESC');
  });
});
