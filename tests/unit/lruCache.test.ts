import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { LRUMap } from '@/features/task-detail/tiptapImageExtension';

describe('LRUMap', () => {
  let revoke: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores and retrieves values', () => {
    const cache = new LRUMap<string, string>(3);
    cache.set('a', 'url-a');
    expect(cache.get('a')).toBe('url-a');
    expect(cache.size).toBe(1);
  });

  it('returns undefined for missing key', () => {
    const cache = new LRUMap<string, string>(3);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('replaces existing key without eviction', () => {
    const cache = new LRUMap<string, string>(3);
    cache.set('a', 'url-a');
    cache.set('a', 'url-a-2');
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe('url-a-2');
    expect(revoke).not.toHaveBeenCalled();
  });

  it('evicts oldest entry when at capacity', () => {
    const cache = new LRUMap<string, string>(2);
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    cache.set('c', 'url-c');
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('url-a');
  });

  it('get re-orders entries (accessed entry is not evicted first)', () => {
    const cache = new LRUMap<string, string>(2);
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    cache.get('a');
    cache.set('c', 'url-c');
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('url-a');
    expect(cache.get('c')).toBe('url-c');
    expect(revoke).toHaveBeenCalledWith('url-b');
  });

  it('re-setting existing key moves it to MRU', () => {
    const cache = new LRUMap<string, string>(2);
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    cache.set('a', 'url-a-2');
    cache.set('c', 'url-c');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('url-a-2');
    expect(cache.get('c')).toBe('url-c');
  });

  it('clear revokes all URLs and empties cache', () => {
    const cache = new LRUMap<string, string>(5);
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    cache.set('c', 'url-c');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(revoke).toHaveBeenCalledTimes(3);
  });

  it('allows set after clear', () => {
    const cache = new LRUMap<string, string>(2);
    cache.set('a', 'url-a');
    cache.clear();
    cache.set('b', 'url-b');
    expect(cache.get('b')).toBe('url-b');
    expect(cache.size).toBe(1);
  });

  it('survives interleaved get and set at capacity', () => {
    const cache = new LRUMap<string, string>(3);
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    cache.set('c', 'url-c');
    cache.get('a');
    cache.set('d', 'url-d');
    expect(cache.size).toBe(3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('url-a');
    expect(cache.get('c')).toBe('url-c');
    expect(cache.get('d')).toBe('url-d');
  });

  it('evicts correctly when capacity is 1', () => {
    const cache = new LRUMap<string, string>(1);
    cache.set('a', 'url-a');
    expect(cache.size).toBe(1);
    cache.set('b', 'url-b');
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('url-b');
    expect(revoke).toHaveBeenCalledWith('url-a');
  });
});
