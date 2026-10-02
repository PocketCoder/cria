import { describe, expect, it } from 'vitest';
import { validateEmailAddress, validateNewPassword } from '@/lib/accountValidation';

describe('validateNewPassword', () => {
  it('rejects mismatches before length', () => {
    expect(validateNewPassword('abc', 'abd')).toBe('Passwords do not match');
  });
  it('rejects short passwords', () => {
    expect(validateNewPassword('abc', 'abc')).toBe('Password must be at least 6 characters');
  });
  it('accepts six characters or more', () => {
    expect(validateNewPassword('abcdef', 'abcdef')).toBeNull();
  });
});

describe('validateEmailAddress', () => {
  it('requires an @', () => {
    expect(validateEmailAddress('nope')).toBe('Invalid email address');
    expect(validateEmailAddress('a@b.c')).toBeNull();
  });
});
