import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/api/errors';
import { makeShareUser, messageFor, serverUrlSchema } from '@/features/login/loginHelpers';

describe('serverUrlSchema', () => {
  it('accepts https and trims', () => {
    expect(serverUrlSchema.parse('  https://vikunja.example.com ')).toBe('https://vikunja.example.com');
  });
  it('accepts http only for loopback hosts', () => {
    expect(serverUrlSchema.safeParse('http://localhost:3456').success).toBe(true);
    expect(serverUrlSchema.safeParse('http://127.0.0.1:3456').success).toBe(true);
    expect(serverUrlSchema.safeParse('http://example.com').success).toBe(false);
  });
  it('rejects non-URLs', () => {
    expect(serverUrlSchema.safeParse('not a url').success).toBe(false);
  });
});

describe('messageFor', () => {
  it('maps API statuses to friendly text', () => {
    expect(messageFor(new ApiError(401, null, 'x', false))).toMatch(/rejected/);
    expect(messageFor(new ApiError(403, null, 'x', false))).toMatch(/rejected/);
    expect(messageFor(new ApiError(404, null, 'x', false))).toMatch(/\/api\/v1/);
    expect(messageFor(new ApiError(500, null, 'Boom', true))).toBe('Boom');
  });
  it('handles network and generic errors', () => {
    expect(messageFor(new NetworkError('x'))).toMatch(/reach the server/);
    expect(messageFor(new Error('plain'))).toBe('plain');
    expect(messageFor('weird')).toBe('Sign-in failed.');
  });
});

describe('makeShareUser', () => {
  it('builds a synthetic user keyed on the share hash', () => {
    const u = makeShareUser('abc');
    expect(u.username).toBe('link-share-abc');
    expect(u.serverId).toBe(0);
    expect(u.name).toBe('Shared project');
    expect(u.defaultProjectId).toBeNull();
  });
});
