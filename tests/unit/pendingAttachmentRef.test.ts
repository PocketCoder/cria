import { describe, it, expect } from 'vitest';
import {
  findPendingAttachmentRefs,
  parsePendingAttachmentRef,
  pendingAttachmentRef,
  replacePendingAttachmentRef,
  stripPendingAttachmentImages,
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

describe('stripPendingAttachmentImages', () => {
  it('removes the image in its stored data-src form and the bare src form', () => {
    const stored =
      '<p>before</p><p><img class="max-w-full h-auto rounded-md" src="#" data-src="cria://pending/att1" alt="photo.png"></p><p>after</p>';
    expect(stripPendingAttachmentImages(stored, 'att1')).toBe('<p>before</p><p></p><p>after</p>');
    expect(stripPendingAttachmentImages('<p>x</p><img src="cria://pending/att1" />', 'att1')).toBe(
      '<p>x</p>',
    );
  });

  it('removes every copy and keeps other images, including an id it prefixes', () => {
    const html =
      '<img data-src="cria://pending/att1"><img data-src="cria://pending/att10">' +
      '<img src="https://x/api/v1/tasks/1/attachments/2"><img data-src="cria://pending/att1">';
    expect(stripPendingAttachmentImages(html, 'att1')).toBe(
      '<img data-src="cria://pending/att10"><img src="https://x/api/v1/tasks/1/attachments/2">',
    );
  });

  it('handles single quotes and a > inside an attribute value', () => {
    const html = `<img alt="a > b" data-src='cria://pending/att1'><p>kept</p>`;
    expect(stripPendingAttachmentImages(html, 'att1')).toBe('<p>kept</p>');
  });

  it('leaves an empty paragraph rather than an empty string', () => {
    expect(stripPendingAttachmentImages('<img src="#" data-src="cria://pending/att1">', 'att1')).toBe(
      '<p></p>',
    );
  });

  it('returns the input untouched when nothing matches', () => {
    const html = '<p>Text mentioning cria://pending/att1 is not an image</p>';
    expect(stripPendingAttachmentImages(html, 'att1')).toBe(html);
    expect(stripPendingAttachmentImages('<p>none</p>', 'att1')).toBe('<p>none</p>');
  });
});
