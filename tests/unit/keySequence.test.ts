import { describe, it, expect } from 'vitest';
import {
  createKeyMatcher,
  eventToKey,
  type KeyBinding,
} from '@/lib/keySequence';

const BINDINGS: KeyBinding[] = [
  { id: 'search', keys: ['mod+k'] },
  { id: 'toggleMenu', keys: ['mod+e'] },
  { id: 'goToday', keys: ['g', 'o'] },
  { id: 'goUpcoming', keys: ['g', 'u'] },
  { id: 'switchList', keys: ['g', 'l'] },
  { id: 'copyId', keys: ['.'] },
  { id: 'copyIdTitle', keys: ['.', '.'] },
  { id: 'copyIdTitleUrl', keys: ['.', '.', '.'] },
  { id: 'done', keys: ['t'] },
];

describe('eventToKey', () => {
  const ev = (key: string, mods: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>> = {}) => ({
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
  });

  it('normalizes plain keys and modifier combos', () => {
    expect(eventToKey(ev('k', { meta: true }))).toBe('mod+k');
    expect(eventToKey(ev('K', { ctrl: true }))).toBe('mod+k');
    expect(eventToKey(ev('g'))).toBe('g');
    expect(eventToKey(ev('R', { shift: true }))).toBe('shift+r');
    expect(eventToKey(ev('ArrowLeft'))).toBe('arrowleft');
    expect(eventToKey(ev('Backspace'))).toBe('backspace');
    expect(eventToKey(ev('.'))).toBe('.');
  });

  it('returns null for bare modifier presses', () => {
    expect(eventToKey(ev('Shift', { shift: true }))).toBeNull();
    expect(eventToKey(ev('Meta', { meta: true }))).toBeNull();
  });
});

describe('createKeyMatcher', () => {
  it('fires single-key bindings immediately when unambiguous', () => {
    const m = createKeyMatcher(BINDINGS, 1000);
    expect(m.feed('t', 0)).toEqual({ fired: ['done'], pending: false });
    expect(m.feed('mod+k', 10)).toEqual({ fired: ['search'], pending: false });
  });

  it('matches two-key sequences within the timeout', () => {
    const m = createKeyMatcher(BINDINGS, 1000);
    expect(m.feed('g', 0)).toEqual({ fired: [], pending: true });
    expect(m.feed('o', 500)).toEqual({ fired: ['goToday'], pending: false });
  });

  it('resets the sequence after the timeout', () => {
    const m = createKeyMatcher(BINDINGS, 1000);
    m.feed('g', 0);
    // 'o' arrives too late — buffer reset; 'o' alone matches nothing.
    expect(m.feed('o', 1500)).toEqual({ fired: [], pending: false });
  });

  it('defers a match that is a prefix of a longer binding, firing on tick', () => {
    const m = createKeyMatcher(BINDINGS, 1000);
    expect(m.feed('.', 0)).toEqual({ fired: [], pending: true });
    // Nothing else typed — tick past the timeout resolves to the exact match.
    expect(m.tick(1100)).toBe('copyId');
    expect(m.tick(2500)).toBeNull();
  });

  it('extends the deferred match as more keys arrive', () => {
    const m = createKeyMatcher(BINDINGS, 1000);
    m.feed('.', 0);
    expect(m.feed('.', 200)).toEqual({ fired: [], pending: true });
    expect(m.feed('.', 400)).toEqual({ fired: ['copyIdTitleUrl'], pending: false });
  });

  it('fires the deferred prefix match when a non-continuation key arrives', () => {
    const m = createKeyMatcher(BINDINGS, 1000);
    m.feed('.', 0);
    // 't' can't extend the '.' sequence: '.' resolves first, then 't' matches.
    expect(m.feed('t', 200)).toEqual({ fired: ['copyId', 'done'], pending: false });
  });

  it('abandons unknown sequences and starts fresh', () => {
    const m = createKeyMatcher(BINDINGS, 1000);
    m.feed('g', 0);
    expect(m.feed('z', 100)).toEqual({ fired: [], pending: false });
    expect(m.feed('t', 200)).toEqual({ fired: ['done'], pending: false });
  });

  it('g-then-o after timeout still starts a fresh g sequence', () => {
    const m = createKeyMatcher(BINDINGS, 1000);
    m.feed('g', 0);
    expect(m.feed('g', 1500)).toEqual({ fired: [], pending: true });
    expect(m.feed('u', 1600)).toEqual({ fired: ['goUpcoming'], pending: false });
  });
});
