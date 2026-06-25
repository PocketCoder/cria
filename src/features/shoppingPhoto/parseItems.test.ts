import { describe, it, expect } from 'vitest';
import { parseShoppingItems } from './parseItems';

describe('parseShoppingItems', () => {
  it('strips bullets, checkboxes and numbered markers', () => {
    expect(
      parseShoppingItems(['- Milk', '• Eggs', '[ ] Bread', '1. Butter', '2) Jam']),
    ).toEqual(['Milk', 'Eggs', 'Bread', 'Butter', 'Jam']);
  });

  it('drops heading lines', () => {
    expect(parseShoppingItems(['Shopping List', 'Milk', 'Groceries:', 'Eggs'])).toEqual([
      'Milk',
      'Eggs',
    ]);
  });

  it('de-duplicates case-insensitively, keeping first occurrence', () => {
    expect(parseShoppingItems(['Milk', 'milk', 'MILK'])).toEqual(['Milk']);
  });

  it('splits comma- and "and"-separated lines into items', () => {
    expect(parseShoppingItems(['milk, eggs and bread'])).toEqual([
      'milk',
      'eggs',
      'bread',
    ]);
  });

  it('does not split decimal quantities like "1,5 kg flour"', () => {
    expect(parseShoppingItems(['1,5 kg flour'])).toEqual(['1,5 kg flour']);
  });

  it('keeps quantity prefixes that are part of the item', () => {
    expect(parseShoppingItems(['2x Apples', '500g Cheese'])).toEqual([
      '2x Apples',
      '500g Cheese',
    ]);
  });

  it('ignores blank lines and whitespace noise', () => {
    expect(parseShoppingItems(['', '   ', '\tMilk\t', 'Eggs '])).toEqual(['Milk', 'Eggs']);
  });

  it('handles embedded newlines in a single OCR block', () => {
    expect(parseShoppingItems(['Milk\nEggs\nBread'])).toEqual(['Milk', 'Eggs', 'Bread']);
  });

  it('drops marker-only / letterless lines', () => {
    expect(parseShoppingItems(['---', '•', '42', 'Milk'])).toEqual(['Milk']);
  });
});
