import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockUseAuth, mockUpdateSession } = vi.hoisted(() => ({
  mockUseAuth: { getState: vi.fn() },
  mockUpdateSession: vi.fn(),
}));

vi.mock('@/auth/store', () => ({
  useAuth: mockUseAuth,
  getAuthSnapshot: vi.fn(() => ({ serverUrl: 'https://example.com', token: 'old' })),
}));

import { readRefreshCookie, refreshSession } from '@/api/client';

describe('readRefreshCookie', () => {
  it('extracts the refresh token from a set-cookie header', () => {
    const h = new Headers({
      'set-cookie': 'vikunja_refresh_token=abc123; Path=/api/v1/user/token/refresh; HttpOnly',
    });
    expect(readRefreshCookie(h)).toBe('abc123');
  });

  it('url-decodes the value', () => {
    const h = new Headers({ 'set-cookie': 'vikunja_refresh_token=a%2Fb; HttpOnly' });
    expect(readRefreshCookie(h)).toBe('a/b');
  });

  it('returns null when the cookie is absent', () => {
    expect(readRefreshCookie(new Headers({ 'set-cookie': 'other=1' }))).toBeNull();
  });

  it('returns null for missing headers', () => {
    expect(readRefreshCookie(undefined)).toBeNull();
    expect(readRefreshCookie(null)).toBeNull();
  });
});

describe('refreshSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no-ops (no network) when not a password session', async () => {
    mockUseAuth.getState.mockReturnValue({ status: { kind: 'unauthenticated' } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshSession()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges the refresh token for a fresh JWT and persists the rotated token', async () => {
    mockUseAuth.getState.mockReturnValue({
      status: {
        kind: 'authenticated',
        credentials: {
          serverUrl: 'https://example.com',
          token: 'old-jwt',
          authMethod: 'password',
          refreshToken: 'r1',
        },
      },
      updateSession: mockUpdateSession,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'new-jwt' }), {
        status: 200,
        headers: { 'set-cookie': 'vikunja_refresh_token=r2; HttpOnly' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshSession()).resolves.toBe('new-jwt');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://example.com/api/v1/user/token/refresh');
    expect((init as RequestInit).method).toBe('POST');
    expect(new Headers((init as RequestInit).headers).get('cookie')).toBe(
      'vikunja_refresh_token=r1',
    );
    expect(mockUpdateSession).toHaveBeenCalledWith('new-jwt', 'r2');
  });

  it('returns null without persisting when refresh is rejected (401)', async () => {
    mockUseAuth.getState.mockReturnValue({
      status: {
        kind: 'authenticated',
        credentials: {
          serverUrl: 'https://example.com',
          token: 'old-jwt',
          authMethod: 'password',
          refreshToken: 'dead',
        },
      },
      updateSession: mockUpdateSession,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));

    await expect(refreshSession()).resolves.toBeNull();
    expect(mockUpdateSession).not.toHaveBeenCalled();
  });
});
