import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUICK_ADD_MAGIC_MODE,
  QUICK_ADD_MAGIC_MODES,
  QUICK_ADD_PREFIXES,
  isQuickAddMagicMode,
} from '@/lib/quickAddPrefixes';

describe('quick add prefixes', () => {
  // Mirrors Vikunja-web's src/modules/quickAddMagic/prefixes.ts.
  it('matches the Vikunja-web prefix table', () => {
    expect(QUICK_ADD_PREFIXES).toEqual({
      disabled: null,
      vikunja: { label: '*', project: '+', assignee: '@', priority: '!' },
      todoist: { label: '@', project: '#', assignee: '+', priority: '!' },
    });
    expect(DEFAULT_QUICK_ADD_MAGIC_MODE).toBe('vikunja');
  });

  it('accepts only the known mode strings', () => {
    for (const mode of QUICK_ADD_MAGIC_MODES) expect(isQuickAddMagicMode(mode)).toBe(true);
    for (const value of ['Vikunja', 'default', '', null, undefined, 1, {}]) {
      expect(isQuickAddMagicMode(value)).toBe(false);
    }
  });
});
