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
});
