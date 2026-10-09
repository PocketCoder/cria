// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '@/lib/sanitize';

describe('sanitizeHtml XSS guards', () => {
  it.each([
    ['<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
    ['<img src="x" onerror="alert(1)">', '<img src="x">'],
    ['<iframe src="https://evil"></iframe>', ''],
    ['<p style="background:url(x)" onclick="x()">t</p>', '<p>t</p>'],
  ])('strips %s', (input, out) => {
    expect(sanitizeHtml(input)).toBe(out);
  });

  it.each(['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x'])(
    'drops unsafe href %s',
    (href) => {
      expect(sanitizeHtml(`<a href="${href}">x</a>`)).not.toContain('href');
    },
  );

  it('hardens safe links with target and rel', () => {
    const out = sanitizeHtml('<a href="https://ok.example" target="_self" rel="opener">x</a>');
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('keeps TipTap task-list state', () => {
    const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">done</li></ul>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('keeps the queued-upload image placeholder', () => {
    const html = '<p><img src="#" data-src="cria://pending/V1StGXR8_Z5jdHi6B-myT"></p>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  // What Vikunja-web stores for an inline image in a description or comment
  // (editorExtensions.ts CustomImage). The id is the web client's DOM hook,
  // regenerated on every render and never parsed back, so dropping it is safe.
  it('keeps the inline image markup Vikunja-web stores, minus its id', () => {
    const url = 'https://vikunja.example/api/v2/tasks/5/attachments/9';
    expect(
      sanitizeHtml(`<p><img data-src="${url}" src="#" alt="Shelf" id="tiptap-image-5-9"></p>`),
    ).toBe(`<p><img data-src="${url}" src="#" alt="Shelf"></p>`);
  });

  it('strips script URLs and handlers from inline images', () => {
    expect(
      sanitizeHtml('<img src="#" data-src="javascript:alert(1)" onload="x()" onerror="y()">'),
    ).toBe('<img src="#">');
    expect(sanitizeHtml('<img src="javascript:alert(1)">')).toBe('<img>');
  });

  it('allows no other cria: URL and no placeholder link', () => {
    expect(sanitizeHtml('<img data-src="cria://evil/x">')).toBe('<img>');
    expect(sanitizeHtml('<a href="cria://pending/abc">x</a>')).not.toContain('href');
  });
});
