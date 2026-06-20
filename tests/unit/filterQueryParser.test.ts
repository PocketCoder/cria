import { describe, it, expect } from 'vitest';
import { parseFilterQuery, type FilterClause, type FilterGroup } from '@/lib/filterQueryParser';

const NOW = new Date(2026, 5, 9, 12, 0, 0);

function expectClause(node: unknown): asserts node is FilterClause {
  if (!node || typeof node !== 'object' || (node as Record<string, unknown>).type !== 'clause') {
    throw new Error('expected clause');
  }
}

function expectGroup(node: unknown): asserts node is FilterGroup {
  if (!node || typeof node !== 'object' || (node as Record<string, unknown>).type !== 'group') {
    throw new Error('expected group');
  }
}

describe('parseFilterQuery', () => {
  it('returns null ast for empty input', () => {
    const q = parseFilterQuery('', NOW);
    expect(q.ast).toBeNull();
    expect(q.includeNulls).toBe(false);
  });

  it('returns null ast for whitespace-only input', () => {
    const q = parseFilterQuery('   ', NOW);
    expect(q.ast).toBeNull();
  });

  describe('Test Case 1: Simple Integer Match', () => {
    it('priority = 4', () => {
      const q = parseFilterQuery('priority = 4', NOW);
      expectClause(q.ast);
      const c = q.ast as FilterClause;
      expect(c.field).toBe('priority');
      expect(c.operator).toBe('=');
      expect(c.value).toEqual({ type: 'number', value: 4 });
    });
  });

  describe('Test Case 2: Relative Date Math Evaluation', () => {
    it('dueDate < now', () => {
      const q = parseFilterQuery('dueDate < now', NOW);
      expectClause(q.ast);
      const c = q.ast as FilterClause;
      expect(c.field).toBe('dueDate');
      expect(c.operator).toBe('<');
      expect(c.value.type).toBe('dateMath');
      if (c.value.type !== 'dateMath') return;
      expect(c.value.value).toBe('now');
      expect(c.value.resolved).toBe(NOW.toISOString());
    });
  });

  describe('Test Case 3: Compound Logic', () => {
    it('done = false && priority >= 3', () => {
      const q = parseFilterQuery('done = false && priority >= 3', NOW);
      expectGroup(q.ast);
      const g = q.ast as FilterGroup;
      expect(g.operator).toBe('&&');
      expect(g.children).toHaveLength(2);

      expectClause(g.children[0]);
      const left = g.children[0] as FilterClause;
      expect(left.field).toBe('done');
      expect(left.operator).toBe('=');
      expect(left.value).toEqual({ type: 'boolean', value: false });

      expectClause(g.children[1]);
      const right = g.children[1] as FilterClause;
      expect(right.field).toBe('priority');
      expect(right.operator).toBe('>=');
      expect(right.value).toEqual({ type: 'number', value: 3 });
    });
  });

  describe('Test Case 4: Array Collection Intersection', () => {
    it('assignees in user1, user2', () => {
      const q = parseFilterQuery('assignees in user1, user2', NOW);
      expectClause(q.ast);
      const c = q.ast as FilterClause;
      expect(c.field).toBe('assignees');
      expect(c.operator).toBe('in');
      expect(c.value.type).toBe('array');
      if (c.value.type !== 'array') return;
      expect(c.value.values).toHaveLength(2);
      expect(c.value.values[0]).toEqual({ type: 'string', value: 'user1' });
      expect(c.value.values[1]).toEqual({ type: 'string', value: 'user2' });
    });
  });

  describe('Test Case 5: Nested Logic Precedence', () => {
    it('(priority = 1 || priority = 2) && dueDate <= now', () => {
      const q = parseFilterQuery('(priority = 1 || priority = 2) && dueDate <= now', NOW);
      expectGroup(q.ast);
      const g = q.ast as FilterGroup;
      expect(g.operator).toBe('&&');
      expect(g.children).toHaveLength(2);

      // Left child should be the OR group
      expectGroup(g.children[0]);
      const left = g.children[0] as FilterGroup;
      expect(left.operator).toBe('||');
      expect(left.children).toHaveLength(2);

      // First OR child: priority = 1
      expectClause(left.children[0]);
      const or1 = left.children[0] as FilterClause;
      expect(or1.field).toBe('priority');
      expect(or1.operator).toBe('=');
      expect(or1.value).toEqual({ type: 'number', value: 1 });

      // Second OR child: priority = 2
      expectClause(left.children[1]);
      const or2 = left.children[1] as FilterClause;
      expect(or2.field).toBe('priority');
      expect(or2.operator).toBe('=');
      expect(or2.value).toEqual({ type: 'number', value: 2 });

      // Right child: dueDate <= now
      expectClause(g.children[1]);
      const right = g.children[1] as FilterClause;
      expect(right.field).toBe('dueDate');
      expect(right.operator).toBe('<=');
      expect(right.value.type).toBe('dateMath');
      if (right.value.type !== 'dateMath') return;
      expect(right.value.value).toBe('now');
      expect(right.value.resolved).toBe(NOW.toISOString());
    });
  });

  describe('Additional operators', () => {
    it('handles != operator', () => {
      const q = parseFilterQuery('done != true', NOW);
      expectClause(q.ast);
      const c = q.ast as FilterClause;
      expect(c.field).toBe('done');
      expect(c.operator).toBe('!=');
      expect(c.value).toEqual({ type: 'boolean', value: true });
    });

    it('handles > operator', () => {
      const q = parseFilterQuery('priority > 2', NOW);
      expectClause(q.ast);
      const c = q.ast as FilterClause;
      expect(c.operator).toBe('>');
      expect(c.value).toEqual({ type: 'number', value: 2 });
    });

    it('handles <= operator', () => {
      const q = parseFilterQuery('percentDone <= 50', NOW);
      expectClause(q.ast);
      const c = q.ast as FilterClause;
      expect(c.operator).toBe('<=');
      expect(c.value).toEqual({ type: 'number', value: 50 });
    });

    it('handles like operator', () => {
      const q = parseFilterQuery('title like %meeting%', NOW);
      expectClause(q.ast);
      const c = q.ast as FilterClause;
      expect(c.operator).toBe('like');
      expect(c.value).toEqual({ type: 'string', value: '%meeting%' });
    });

    it('handles not in operator', () => {
      const q = parseFilterQuery('labels not in urgent, backlog', NOW);
      expectClause(q.ast);
      const c = q.ast as FilterClause;
      expect(c.field).toBe('labels');
      expect(c.operator).toBe('not in');
      expect(c.value.type).toBe('array');
      if (c.value.type !== 'array') return;
      expect(c.value.values).toHaveLength(2);
      expect(c.value.values[0]).toEqual({ type: 'string', value: 'urgent' });
      expect(c.value.values[1]).toEqual({ type: 'string', value: 'backlog' });
    });
  });

  describe('Logical operators', () => {
    it('handles || precedence with &&', () => {
      const q = parseFilterQuery('priority = 1 || priority = 2 && dueDate < now', NOW);
      expectGroup(q.ast);
      const g = q.ast as FilterGroup;
      expect(g.operator).toBe('||');
      expect(g.children).toHaveLength(2);

      // Left: priority = 1 (clause)
      expectClause(g.children[0]);

      // Right: group &&
      expectGroup(g.children[1]);
      const right = g.children[1] as FilterGroup;
      expect(right.operator).toBe('&&');
    });
  });
});
