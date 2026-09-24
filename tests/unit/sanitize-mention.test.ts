// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '@/lib/sanitize';

// Vikunja web serializes mentions as a <mention-user> custom element
// (upstream TipTap.vue renderHTML) and the SERVER parses that element from
// stored HTML to create mention notifications — so it must survive
// sanitisation byte-for-byte in tag + data-id.
describe('sanitizeHtml mention markup', () => {
  it('preserves <mention-user data-id> exactly', () => {
    const html = '<p>hi <mention-user data-id="alice">@alice</mention-user>!</p>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('still strips scripts and event handlers around mentions', () => {
    const out = sanitizeHtml(
      '<p><mention-user data-id="a" onclick="alert(1)">@a</mention-user><script>alert(2)</script></p>',
    );
    expect(out).toContain('<mention-user data-id="a">@a</mention-user>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
  });

  it('does not open the door to other custom elements', () => {
    expect(sanitizeHtml('<other-thing data-id="x">y</other-thing>')).not.toContain('other-thing');
  });
});
