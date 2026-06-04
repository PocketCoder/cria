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
