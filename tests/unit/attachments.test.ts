import { describe, it, expect, vi } from 'vitest';

// Mock auth store so apiBase() returns a stable URL for isAttachmentUrl /
// buildAttachmentUrl tests.
vi.mock('@/auth/store', () => ({
  getAuthSnapshot: () => ({ serverUrl: 'https://tasks.example.com', token: 'test-token' }),
}));

import {
  isAttachmentUrl,
  parseAttachmentUrl,
  buildAttachmentUrl,
  inlineImageSource,
} from '@/sync/attachments';

describe('buildAttachmentUrl', () => {
  it('builds a well-formed URL from task and attachment ids', () => {
    expect(buildAttachmentUrl(42, 7)).toBe(
      'https://tasks.example.com/api/v1/tasks/42/attachments/7',
    );
  });

  it('handles large ids', () => {
    const url = buildAttachmentUrl(999999, 888888);
    expect(url).toContain('/tasks/999999/attachments/888888');
  });
});

describe('isAttachmentUrl', () => {
  it('returns true for a matching attachment URL', () => {
    expect(isAttachmentUrl('https://tasks.example.com/api/v1/tasks/42/attachments/7')).toBe(true);
  });

  it('returns false for null', () => {
    expect(isAttachmentUrl(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isAttachmentUrl(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAttachmentUrl('')).toBe(false);
  });

  it('returns false for an external URL', () => {
    expect(isAttachmentUrl('https://other.example.com/image.png')).toBe(false);
  });

  it('returns false for same-server non-attachment URL', () => {
    expect(isAttachmentUrl('https://tasks.example.com/api/v1/tasks/42')).toBe(false);
  });

  it('returns false when URL has no /attachments/ segment', () => {
    expect(isAttachmentUrl('https://tasks.example.com/api/v1/tasks/42/files/7')).toBe(false);
  });

  // Vikunja-web v2.7.0 writes `${root}/api/v2/tasks/{t}/attachments/{a}`
  // (helpers/attachments.ts generateAttachmentUrl) and its editor matches
  // /^(.*?)(?:\/api\/v[12])?\/tasks\/(\d+)\/attachments\/(\d+)$/ against
  // the API root. Every earlier release writes `/api/v1/...`.
  it('recognises the v2 shape newer Vikunja-web writes', () => {
    expect(isAttachmentUrl('https://tasks.example.com/api/v2/tasks/42/attachments/7')).toBe(true);
  });

  it('recognises the unversioned shape upstream also resolves', () => {
    expect(isAttachmentUrl('https://tasks.example.com/tasks/42/attachments/7')).toBe(true);
  });

  it('tolerates a trailing slash, query or fragment', () => {
    expect(isAttachmentUrl('https://tasks.example.com/api/v2/tasks/42/attachments/7/')).toBe(true);
    expect(isAttachmentUrl('https://tasks.example.com/api/v1/tasks/42/attachments/7?preview_size=md')).toBe(true);
    expect(isAttachmentUrl('https://tasks.example.com/api/v2/tasks/42/attachments/7#x')).toBe(true);
  });

  it('rejects an attachment path on another host', () => {
    expect(isAttachmentUrl('https://attacker.example/api/v2/tasks/42/attachments/7')).toBe(false);
    expect(isAttachmentUrl('https://attacker.example/tasks/42/attachments/7')).toBe(false);
  });

  it('rejects a host that merely starts with the server host', () => {
    expect(isAttachmentUrl('https://tasks.example.com.evil.test/api/v2/tasks/42/attachments/7')).toBe(false);
    expect(isAttachmentUrl('https://tasks.example.com:8443/api/v2/tasks/42/attachments/7')).toBe(false);
  });

  it('rejects an unknown API version or extra path', () => {
    expect(isAttachmentUrl('https://tasks.example.com/api/v3/tasks/42/attachments/7')).toBe(false);
    expect(isAttachmentUrl('https://tasks.example.com/api/v2/tasks/42/attachments/7/extra')).toBe(false);
    expect(isAttachmentUrl('https://tasks.example.com/other/api/v2/tasks/42/attachments/7')).toBe(false);
  });

  it('parses the ids out of a v2 URL', () => {
    expect(parseAttachmentUrl('https://tasks.example.com/api/v2/tasks/42/attachments/7')).toEqual({
      taskServerId: 42,
      attachmentServerId: 7,
    });
  });
});

describe('isAttachmentUrl with a sub-path server', () => {
  it('matches v1 and v2 shapes under the sub-path only', async () => {
    vi.resetModules();
    vi.doMock('@/auth/store', () => ({
      getAuthSnapshot: () => ({ serverUrl: 'https://example.com/vikunja/', token: 't' }),
    }));
    const mod = await import('@/sync/attachments');
    expect(mod.isAttachmentUrl('https://example.com/vikunja/api/v1/tasks/5/attachments/9')).toBe(true);
    expect(mod.isAttachmentUrl('https://example.com/vikunja/api/v2/tasks/5/attachments/9')).toBe(true);
    expect(mod.isAttachmentUrl('https://example.com/api/v2/tasks/5/attachments/9')).toBe(false);
    // Writing stays on v1, the API Cria talks to.
    expect(mod.buildAttachmentUrl(5, 9)).toBe(
      'https://example.com/vikunja/api/v1/tasks/5/attachments/9',
    );
    vi.doUnmock('@/auth/store');
  });
});

describe('parseAttachmentUrl', () => {
  it('extracts task and attachment ids from a well-formed URL', () => {
    expect(parseAttachmentUrl('https://tasks.example.com/api/v1/tasks/42/attachments/7')).toEqual({
      taskServerId: 42,
      attachmentServerId: 7,
    });
  });

  it('extracts ids from a URL with trailing slash', () => {
    const url = 'https://tasks.example.com/api/v1/tasks/42/attachments/7/';
    expect(parseAttachmentUrl(url)).toEqual({
      taskServerId: 42,
      attachmentServerId: 7,
    });
  });

  it('extracts ids from a URL with query params', () => {
    const url = 'https://tasks.example.com/api/v1/tasks/42/attachments/7?download=true';
    expect(parseAttachmentUrl(url)).toEqual({
      taskServerId: 42,
      attachmentServerId: 7,
    });
  });

  it('returns null for a non-matching URL', () => {
    expect(parseAttachmentUrl('https://example.com/image.png')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseAttachmentUrl('')).toBeNull();
  });

  it('parses large ids', () => {
    const url = 'https://tasks.example.com/api/v1/tasks/999999/attachments/888888';
    expect(parseAttachmentUrl(url)).toEqual({
      taskServerId: 999999,
      attachmentServerId: 888888,
    });
  });

  it('handles extra path segments before /tasks/', () => {
    const url = 'https://tasks.example.com/v2/api/v1/tasks/42/attachments/7';
    expect(parseAttachmentUrl(url)).toEqual({
      taskServerId: 42,
      attachmentServerId: 7,
    });
  });
});

// What each client stores for an inline image in a description or comment:
// Vikunja-web <= v2.6.0 writes `<img data-src="{API_URL}/tasks/…" src="#"
// id="tiptap-image-{t}-{a}">` with API_URL ending in /api/v1, v2.7.0 the same
// with `{root}/api/v2/…`; older text has the URL in `src`; Cria writes the
// v1 shape, or `cria://pending/{id}` while the upload is queued.
describe('inlineImageSource', () => {
  const attachment = { kind: 'attachment', taskServerId: 5, attachmentServerId: 9 };

  it('reads the v2 URL Vikunja-web v2.7.0 stores in data-src', () => {
    expect(
      inlineImageSource('#', 'https://tasks.example.com/api/v2/tasks/5/attachments/9'),
    ).toEqual(attachment);
  });

  it('reads the v1 URL earlier Vikunja-web and Cria store in data-src', () => {
    expect(
      inlineImageSource('#', 'https://tasks.example.com/api/v1/tasks/5/attachments/9'),
    ).toEqual(attachment);
  });

  it('reads a legacy URL kept in src alone', () => {
    expect(
      inlineImageSource('https://tasks.example.com/api/v1/tasks/5/attachments/9', null),
    ).toEqual(attachment);
  });

  it('prefers data-src over src, as upstream does', () => {
    expect(
      inlineImageSource(
        'https://tasks.example.com/api/v1/tasks/1/attachments/2',
        'https://tasks.example.com/api/v2/tasks/5/attachments/9',
      ),
    ).toEqual(attachment);
    expect(
      inlineImageSource(
        'https://tasks.example.com/api/v1/tasks/5/attachments/9',
        'https://elsewhere.example/x.png',
      ),
    ).toBeNull();
  });

  it('reads a queued upload placeholder from data-src or src', () => {
    const pending = { kind: 'pending', attachmentLocalId: 'V1StGXR8_Z5jdHi6B-myT' };
    expect(inlineImageSource('#', 'cria://pending/V1StGXR8_Z5jdHi6B-myT')).toEqual(pending);
    expect(inlineImageSource('cria://pending/V1StGXR8_Z5jdHi6B-myT', null)).toEqual(pending);
  });

  it('leaves images the browser can load alone', () => {
    expect(inlineImageSource('https://elsewhere.example/x.png', null)).toBeNull();
    expect(
      inlineImageSource('#', 'https://attacker.example/api/v2/tasks/5/attachments/9'),
    ).toBeNull();
    expect(inlineImageSource('data:image/png;base64,AAAA', null)).toBeNull();
    expect(inlineImageSource('#', null)).toBeNull();
    expect(inlineImageSource(null, null)).toBeNull();
    expect(inlineImageSource(undefined, undefined)).toBeNull();
  });
});
