import { describe, it, expect } from 'vitest';
import { shareUrlFor } from '@/lib/shareUrl';

describe('shareUrlFor', () => {
  it('prefers the configured frontend_url', () => {
    expect(shareUrlFor('https://api.example.com/api/v1', 'https://vikunja.example.com/', 'abc123'))
      .toBe('https://vikunja.example.com/share/abc123/auth');
  });

  it('falls back to stripping /api/v1 from the server url', () => {
    expect(shareUrlFor('https://vikunja.example.com/api/v1', null, 'abc123'))
      .toBe('https://vikunja.example.com/share/abc123/auth');
    expect(shareUrlFor('https://vikunja.example.com/api/v1/', '', 'abc123'))
      .toBe('https://vikunja.example.com/share/abc123/auth');
  });

  it('handles a server url without the /api/v1 suffix', () => {
    expect(shareUrlFor('https://vikunja.example.com', null, 'abc123'))
      .toBe('https://vikunja.example.com/share/abc123/auth');
  });
});
