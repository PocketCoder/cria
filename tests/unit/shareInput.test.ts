import { describe, it, expect } from 'vitest';
import { parseShareInput } from '@/lib/shareInput';

describe('parseShareInput', () => {
  it('extracts the hash from a full share URL', () => {
    expect(parseShareInput('https://vikunja.example.com/share/aBc123XyZ/auth')).toBe('aBc123XyZ');
    expect(parseShareInput('https://vikunja.example.com/share/aBc123XyZ')).toBe('aBc123XyZ');
    expect(parseShareInput('https://v.example.com/share/aBc123XyZ/auth?x=1')).toBe('aBc123XyZ');
  });

  it('accepts a bare hash', () => {
    expect(parseShareInput('aBc123XyZ')).toBe('aBc123XyZ');
    expect(parseShareInput('  aBc123XyZ  ')).toBe('aBc123XyZ');
  });

  it('rejects garbage', () => {
    expect(parseShareInput('')).toBeNull();
    expect(parseShareInput('https://example.com/tasks/5')).toBeNull();
    expect(parseShareInput('not a hash!!!')).toBeNull();
  });
});
