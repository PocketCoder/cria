import { describe, it, expect } from 'vitest';
import {
  findPendingAttachmentRefs,
  parsePendingAttachmentRef,
  pendingAttachmentRef,
  replacePendingAttachmentRef,
} from '@/lib/pendingAttachmentRef';

describe('pendingAttachmentRef', () => {
  it('builds and parses a reference', () => {
    const ref = pendingAttachmentRef('V1StGXR8_Z5jdHi6B-myT');
    expect(ref).toBe('cria://pending/V1StGXR8_Z5jdHi6B-myT');
    expect(parsePendingAttachmentRef(ref)).toBe('V1StGXR8_Z5jdHi6B-myT');
  });

  it.each([null, undefined, '', '#', 'https://x/api/v1/tasks/1/attachments/2', 'cria://pending/', 'cria://pending/a/b'])(
    'does not parse %s',
    (src) => {
      expect(parsePendingAttachmentRef(src)).toBeNull();
    },
  );

  it('finds distinct references in HTML', () => {
    const html =
      '<img src="#" data-src="cria://pending/a1"><img data-src="cria://pending/b2"><img data-src="cria://pending/a1">';
    expect(findPendingAttachmentRefs(html)).toEqual(['a1', 'b2']);
    expect(findPendingAttachmentRefs('<p>none</p>')).toEqual([]);
    expect(findPendingAttachmentRefs(null)).toEqual([]);
  });

  it('replaces only the exact id, never one it prefixes', () => {
    const html = '<img data-src="cria://pending/att1"><img data-src="cria://pending/att10">';
    expect(replacePendingAttachmentRef(html, 'att1', 'https://x/a/7')).toBe(
      '<img data-src="https://x/a/7"><img data-src="cria://pending/att10">',
    );
  });
});
