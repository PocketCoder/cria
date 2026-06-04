import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/cn';

describe('cn', () => {
  it('joins multiple class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('filters falsy values', () => {
    expect(cn('a', false && 'b', undefined, null, 0, 'c')).toBe('a c');
  });

  it('handles tailwind-merge conflict resolution', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('merges responsive and state variants', () => {
    expect(cn('p-2', 'p-4', 'hover:p-6', 'lg:p-8')).toBe('p-4 hover:p-6 lg:p-8');
  });

  it('handles clsx object syntax', () => {
    expect(cn({ foo: true, bar: false }, 'baz')).toBe('foo baz');
  });

  it('returns empty string for no args', () => {
    expect(cn()).toBe('');
  });
});
