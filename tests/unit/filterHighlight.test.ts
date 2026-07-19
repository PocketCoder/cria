import { describe, it, expect } from 'vitest';
import { highlightSpans, autocompleteContext } from '@/lib/filterHighlight';

function kindsOf(query: string): Array<[string, string]> {
  return highlightSpans(query).map((s) => [query.slice(s.start, s.end), s.kind]);
}

describe('highlightSpans', () => {
  it('classifies fields, operators, values and logical joins', () => {
    expect(kindsOf('done = false && priority >= 3')).toEqual([
      ['done', 'field'],
      ['=', 'operator'],
      ['false', 'value'],
      ['&&', 'logical'],
      ['priority', 'field'],
      ['>=', 'operator'],
      ['3', 'value'],
    ]);
  });

  it('classifies strings, date-math, parens and in-lists', () => {
    expect(kindsOf("(dueDate < now || labels in 'urgent', 'soon')")).toEqual([
      ['(', 'paren'],
      ['dueDate', 'field'],
      ['<', 'operator'],
      ['now', 'value'],
      ['||', 'logical'],
      ['labels', 'field'],
      ['in', 'operator'],
      ["'urgent'", 'value'],
      [',', 'paren'],
      ["'soon'", 'value'],
      [')', 'paren'],
    ]);
  });

  it('marks unknown identifiers in field position as unknown', () => {
    expect(kindsOf('bogus = 1')[0]).toEqual(['bogus', 'unknown']);
  });

  it('never throws on partial input', () => {
    expect(() => highlightSpans("labels in '")).not.toThrow();
    expect(() => highlightSpans('done =')).not.toThrow();
  });
});

describe('autocompleteContext', () => {
  it('suggests fields at the start and after logical operators', () => {
    expect(autocompleteContext('', 0)).toEqual({ kind: 'field', prefix: '', replaceStart: 0 });
    expect(autocompleteContext('pri', 3)).toEqual({ kind: 'field', prefix: 'pri', replaceStart: 0 });
    expect(autocompleteContext('done = false && du', 18)).toEqual({
      kind: 'field', prefix: 'du', replaceStart: 16,
    });
  });

  it('suggests label values after labels operators', () => {
    expect(autocompleteContext('labels in ur', 12)).toEqual({
      kind: 'label', prefix: 'ur', replaceStart: 10,
    });
    expect(autocompleteContext("labels = 'ur", 12)).toEqual({
      kind: 'label', prefix: 'ur', replaceStart: 9,
    });
  });

  it('suggests projects and assignees after their fields', () => {
    expect(autocompleteContext('project = Wo', 12)).toEqual({
      kind: 'project', prefix: 'Wo', replaceStart: 10,
    });
    expect(autocompleteContext('assignees in al', 15)).toEqual({
      kind: 'assignee', prefix: 'al', replaceStart: 13,
    });
  });

  it('returns null in value position for non-entity fields', () => {
    expect(autocompleteContext('priority = 3', 12)).toBeNull();
    expect(autocompleteContext('done = fa', 9)).toBeNull();
  });
});
