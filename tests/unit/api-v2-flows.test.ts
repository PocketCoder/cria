/**
 * Sign-in, refresh, multipart attachments and reactions against a server that
 * answers like Vikunja v1 or v2: the version is probed from /info, v2 uses
 * /api/v2 (same login/refresh verbs, problem+json errors, 204 deletes), and
 * "Force API v1" keeps everything on /api/v1.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockUseAuth, mockUpdateSession } = vi.hoisted(() => ({
  mockUseAuth: { getState: vi.fn() },
  mockUpdateSession: vi.fn(),
}));
vi.mock('@/auth/store', () => ({
  useAuth: mockUseAuth,
  getAuthSnapshot: () => ({ serverUrl: 'https://vk.example', token: 'tk' }),
}));

import { loginWithPassword, isTotpRequired } from '@/api/login';
import { refreshSession, probeServer } from '@/api/client';
import { putAttachmentFile, deleteAttachment } from '@/sync/attachments';
import { getApiVersion, resetApiVersion, setDetectedApiVersion } from '@/api/apiVersion';
import { useSettings } from '@/stores/settings';
import { _resetResilience } from '@/api/resilience';
import { ApiError } from '@/api/errors';
import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';

const SERVER = 'https://vk.example';
const problem = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/problem+json' } });
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });

let calls: { method: string; url: string; headers: Headers }[];

function stubServer(version: string, handler?: (url: URL, method: string) => Response | undefined) {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (req?.method ?? init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url: url.pathname, headers: new Headers(req ? req.headers : init?.headers) });
    if (url.pathname === '/api/v1/info') return json({ version });
    return handler?.(url, method) ?? json({});
  });
}

beforeEach(() => {
  _resetResilience();
  resetApiVersion();
  useSettings.setState({ forceApiV1: false });
  mockUpdateSession.mockReset();
  mockUseAuth.getState.mockReturnValue({ status: { kind: 'unauthenticated' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('version probe', () => {
  it('records the decision from /info', async () => {
    stubServer('v2.7.0-16-g58f7cf47');
    await probeServer(SERVER);
    expect(getApiVersion(SERVER)).toBe('v2');
    stubServer('v2.6.0');
    await probeServer(SERVER);
    expect(getApiVersion(SERVER)).toBe('v1');
  });
});

describe('loginWithPassword', () => {
  const ok = (url: URL) => (url.pathname.endsWith('/login') ? json({ token: 'jwt' }, { headers: { 'set-cookie': 'vikunja_refresh_token=r1; HttpOnly' } }) : undefined);

  it('re-probes at sign-in and logs in over /api/v2 on a v2.7+ server', async () => {
    stubServer('v2.7.0', ok);
    await expect(loginWithPassword(SERVER, { username: 'a', password: 'b' })).resolves.toEqual({ token: 'jwt', refreshToken: 'r1' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/v1/info', 'POST /api/v2/login']);
  });

  it('logs in over /api/v1 on an older server', async () => {
    stubServer('v2.6.1', ok);
    await loginWithPassword(SERVER, { username: 'a', password: 'b' });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/api/v1/login' });
  });

  it('honours "Force API v1" on a v2 server', async () => {
    useSettings.setState({ forceApiV1: true });
    stubServer('v2.7.0', ok);
    await loginWithPassword(SERVER, { username: 'a', password: 'b' });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/api/v1/login' });
  });

  it('re-decides when the server changes under the same URL (upgrade)', async () => {
    stubServer('v2.6.0', ok);
    await loginWithPassword(SERVER, { username: 'a', password: 'b' });
    stubServer('v2.7.0', ok);
    await loginWithPassword(SERVER, { username: 'a', password: 'b' });
    expect(calls.at(-1)!.url).toBe('/api/v2/login');
  });

  it('reads a v2 problem+json TOTP prompt (412, code 1017)', async () => {
    stubServer('v2.7.0', () => problem(412, { title: 'Precondition Failed', status: 412, detail: 'Invalid totp passcode.', code: 1017 }));
    const err = await loginWithPassword(SERVER, { username: 'a', password: 'b' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Invalid totp passcode.');
    expect(err.code).toBe(1017);
    expect(isTotpRequired(err)).toBe(true);
  });

  it('treats a v2 validation failure (422) as a plain error, not TOTP', async () => {
    stubServer('v2.7.0', () => problem(422, { title: 'Unprocessable Entity', status: 422, detail: 'username: required', code: 2002 }));
    const err = await loginWithPassword(SERVER, { username: '', password: 'b' }).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.message).toBe('username: required');
    expect(isTotpRequired(err)).toBe(false);
  });

  it('keeps the v1 412 TOTP prompt', async () => {
    stubServer('v2.6.0', () => json({ code: 1017, message: 'Invalid totp passcode.' }, { status: 412 }));
    const err = await loginWithPassword(SERVER, { username: 'a', password: 'b' }).catch((e) => e);
    expect(isTotpRequired(err)).toBe(true);
  });
});

describe('refreshSession uses the version the session decided on', () => {
  const creds = { serverUrl: SERVER, token: 'old', authMethod: 'password', refreshToken: 'r1' };
  beforeEach(() => {
    mockUseAuth.getState.mockReturnValue({ status: { kind: 'authenticated', credentials: creds }, updateSession: mockUpdateSession });
  });

  it('POSTs the refresh cookie to /api/v2/user/token/refresh on v2', async () => {
    setDetectedApiVersion(SERVER, 'v2');
    stubServer('v2.7.0', () => json({ token: 'new' }, { headers: { 'set-cookie': 'vikunja_refresh_token=r2; Path=/api/v2/user/token/refresh; HttpOnly' } }));
    await expect(refreshSession()).resolves.toBe('new');
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v2/user/token/refresh' });
    expect(calls[0]!.headers.get('cookie')).toBe('vikunja_refresh_token=r1');
    expect(mockUpdateSession).toHaveBeenCalledWith('new', 'r2');
  });

  it('stays on /api/v1 when v1 is decided or forced', async () => {
    setDetectedApiVersion(SERVER, 'v2');
    useSettings.setState({ forceApiV1: true });
    stubServer('v2.7.0', () => json({ token: 'new' }));
    await refreshSession();
    expect(calls[0]!.url).toBe('/api/v1/user/token/refresh');
  });
});

describe('attachments', () => {
  beforeEach(async () => {
    await initSchema();
    await clearTables();
    await getDb();
  });
  const uploaded = { success: [{ id: 5, task_id: 1, created: '2020-01-01T00:00:00Z', file: { id: 9, name: 'a.txt', size: 1, mime: 'text/plain', created: '2020-01-01T00:00:00Z' } }], errors: null };

  it('uploads with PUT on v1 and POST on v2 (field name files either way)', async () => {
    for (const [v, method] of [['v1', 'PUT'], ['v2', 'POST']] as const) {
      setDetectedApiVersion(SERVER, v);
      stubServer('x', () => json(uploaded, { status: v === 'v2' ? 201 : 200 }));
      await putAttachmentFile(1, new Uint8Array([1]) as Uint8Array<ArrayBuffer>, 'a.txt', 'text/plain');
      expect(calls[0]).toMatchObject({ method, url: `/api/${v}/tasks/1/attachments` });
    }
  });

  it('deletes a v2 attachment from its 204 and tolerates a problem+json 404', async () => {
    setDetectedApiVersion(SERVER, 'v2');
    stubServer('x', () => new Response(null, { status: 204 }));
    await deleteAttachment(1, 'local-task', 5);
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: '/api/v2/tasks/1/attachments/5' });
    stubServer('x', () => problem(404, { title: 'Not Found', status: 404, code: 4002 }));
    await expect(deleteAttachment(1, 'local-task', 5)).resolves.toBeUndefined();
  });
});
