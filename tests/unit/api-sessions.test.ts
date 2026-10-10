import { describe, it, expect, vi, beforeEach } from 'vitest';
import { currentSessionId, describeDevice, listSessions, revokeSession } from '@/api/sessions';

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('@/api/client', () => ({ createApiFetch: () => mockApiFetch }));

beforeEach(() => vi.clearAllMocks());

const jwt = (payload: object) =>
  `h.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.s`;

describe('sessions api', () => {
  it('listSessions maps the payload and treats the no-date sentinel as unset', async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 'a', device_info: 'UA', ip_address: '1.2.3.4', last_active: '2026-10-01T10:00:00Z', created: '0001-01-01T00:00:00Z' },
          { device_info: 'no id' },
        ]),
        { status: 200 },
      ),
    );
    expect(await listSessions()).toEqual([
      { id: 'a', deviceInfo: 'UA', ipAddress: '1.2.3.4', lastActive: '2026-10-01T10:00:00Z', created: null },
    ]);
    expect(mockApiFetch.mock.calls[0]![0]).toBe('/user/sessions?per_page=50');
  });

  it('listSessions is null on 404 (older servers) and throws on other errors', async () => {
    mockApiFetch.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await listSessions()).toBeNull();
    mockApiFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(listSessions()).rejects.toThrow();
  });

  it('revokeSession DELETEs the encoded id', async () => {
    mockApiFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    await revokeSession('a/b');
    expect(mockApiFetch).toHaveBeenCalledWith('/user/sessions/a%2Fb', { method: 'DELETE' });
  });

  it('revokeSession throws on failure', async () => {
    mockApiFetch.mockResolvedValue(new Response('no', { status: 403 }));
    await expect(revokeSession('x')).rejects.toThrow();
  });
});

describe('currentSessionId', () => {
  it('reads the sid claim of a JWT', () => {
    expect(currentSessionId(jwt({ sid: 'abc-123' }))).toBe('abc-123');
  });
  it('is null for API tokens, junk and missing claims', () => {
    expect(currentSessionId('tk_plainapitoken')).toBeNull();
    expect(currentSessionId('a.!!!.c')).toBeNull();
    expect(currentSessionId(jwt({ id: 1 }))).toBeNull();
    expect(currentSessionId(null)).toBeNull();
  });
});

describe('describeDevice', () => {
  it('summarises common user agents', () => {
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)')).toBe('Cria on macOS');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18 Safari/604.1')).toBe('Safari on iPhone');
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36')).toBe('Chrome on Linux');
  });
  it('falls back for empty or unknown agents', () => {
    expect(describeDevice('')).toBe('Unknown device');
    expect(describeDevice('curl/8.0')).toBe('curl/8.0');
  });
});
