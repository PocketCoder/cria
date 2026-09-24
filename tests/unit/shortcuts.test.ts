import { describe, it, expect } from 'vitest';
import { SHORTCUTS, MATCHABLE_SHORTCUTS } from '@/lib/shortcuts';
import { createKeyMatcher } from '@/lib/keySequence';

describe('shortcut definition table', () => {
  it('has unique ids', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate key sequences within the same context', () => {
    const seen = new Map<string, string>();
    for (const s of MATCHABLE_SHORTCUTS) {
      const sig = `${s.context}:${s.keys.join(' ')}`;
      expect(seen.has(sig), `duplicate binding ${sig} (${s.id} vs ${seen.get(sig)})`).toBe(false);
      seen.set(sig, s.id);
    }
  });

  it('every matchable binding is reachable through the matcher', () => {
    for (const s of MATCHABLE_SHORTCUTS) {
      const m = createKeyMatcher(MATCHABLE_SHORTCUTS, 1000);
      let fired: string[] = [];
      s.keys.forEach((k, i) => {
        fired = fired.concat(m.feed(k, i * 100).fired);
      });
      const late = m.tick(s.keys.length * 100 + 2000);
      if (late) fired.push(late);
      expect(fired, `binding ${s.id} unreachable`).toContain(s.id);
    }
  });

  it('every shortcut has display metadata for the settings tab', () => {
    for (const s of SHORTCUTS) {
      expect(s.group.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});
