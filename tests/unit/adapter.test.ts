import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  adaptedFetch,
  isV1OnlyRoute,
  planRoute,
  resolveApiCall,
  sendMergePatch,
  splitApiUrl,
} from '@/api/adapter';
import { buildApiError, ApiError } from '@/api/errors';
import { isTotpRequired } from '@/api/login';
import { resetApiVersion, setDetectedApiVersion } from '@/api/apiVersion';

const ROOT = 'https://vk.example';

beforeEach(() => {
  resetApiVersion();
});

describe('planRoute: verbs and paths (v1 -> v2, from the contract table)', () => {
  // [v1 method, v1 path, expected v2 method, expected v2 path]
  const table: [string, string, string, string][] = [
    // creates: PUT -> POST
    ['PUT', '/projects', 'POST', '/projects'],
    ['PUT', '/labels', 'POST', '/labels'],
    ['PUT', '/filters', 'POST', '/filters'],
    ['PUT', '/teams', 'POST', '/teams'],
    ['PUT', '/tokens', 'POST', '/tokens'],
    ['PUT', '/projects/3/tasks', 'POST', '/projects/3/tasks'],
    ['PUT', '/projects/3/views', 'POST', '/projects/3/views'],
    ['PUT', '/projects/3/views/4/buckets', 'POST', '/projects/3/views/4/buckets'],
    ['PUT', '/projects/3/shares', 'POST', '/projects/3/shares'],
    ['PUT', '/tasks/9/assignees', 'POST', '/tasks/9/assignees'],
    ['PUT', '/tasks/9/labels', 'POST', '/tasks/9/labels'],
    ['PUT', '/tasks/9/comments', 'POST', '/tasks/9/comments'],
    ['PUT', '/tasks/9/relations', 'POST', '/tasks/9/relations'],
    ['PUT', '/tasks/9/attachments', 'POST', '/tasks/9/attachments'],
    ['PUT', '/teams/2/members', 'POST', '/teams/2/members'],
    ['PUT', '/tasks/9/reactions', 'POST', '/tasks/9/reactions'],
    ['PUT', '/subscriptions/task/9', 'POST', '/subscriptions/task/9'],
    ['PUT', '/user/settings/token/caldav', 'POST', '/user/settings/token/caldav'],
    ['PUT', '/projects/3/duplicate', 'POST', '/projects/3/duplicate'],
    // updates: POST -> PUT
    ['POST', '/projects/3', 'PUT', '/projects/3'],
    ['POST', '/tasks/9', 'PUT', '/tasks/9'],
    ['POST', '/filters/3', 'PUT', '/filters/3'],
    ['POST', '/teams/3', 'PUT', '/teams/3'],
    ['POST', '/projects/3/views/4', 'PUT', '/projects/3/views/4'],
    ['POST', '/tasks/9/comments/5', 'PUT', '/tasks/9/comments/5'],
    ['POST', '/projects/3/views/4/buckets/5', 'PUT', '/projects/3/views/4/buckets/5'],
    ['POST', '/projects/3/users/7', 'PUT', '/projects/3/users/7'],
    ['POST', '/projects/3/teams/7', 'PUT', '/projects/3/teams/7'],
    ['POST', '/notifications/8', 'PUT', '/notifications/8'],
    ['POST', '/tasks/9/position', 'PUT', '/tasks/9/position'],
    ['POST', '/tasks/bulk', 'PUT', '/tasks/bulk'],
    ['POST', '/projects/3/views/4/buckets/5/tasks', 'PUT', '/projects/3/views/4/buckets/5/tasks'],
    ['POST', '/user/settings/email', 'PUT', '/user/settings/email'],
    // unchanged verbs
    ['POST', '/login', 'POST', '/login'],
    ['POST', '/user/token/refresh', 'POST', '/user/token/refresh'],
    ['POST', '/user/token', 'POST', '/user/token'],
    ['POST', '/shares/abc/auth', 'POST', '/shares/abc/auth'],
    ['POST', '/notifications', 'POST', '/notifications'],
    ['POST', '/teams/2/members/7/admin', 'POST', '/teams/2/members/7/admin'],
    ['POST', '/comments/5/reactions/delete', 'POST', '/comments/5/reactions/delete'],
    ['POST', '/user/password', 'POST', '/user/password'],
    ['POST', '/user/export/download', 'POST', '/user/export/download'],
    ['POST', '/user/deletion/request', 'POST', '/user/deletion/request'],
    ['PUT', '/labels/4', 'PUT', '/labels/4'],
    ['PUT', '/projects/3/backgrounds/upload', 'PUT', '/projects/3/backgrounds/upload'],
    ['GET', '/tasks', 'GET', '/tasks'],
    ['DELETE', '/tasks/9', 'DELETE', '/tasks/9'],
    // renamed paths
    ['GET', '/projects/3/projectusers', 'GET', '/projects/3/users/search'],
    ['GET', '/jane/avatar', 'GET', '/avatar/jane'],
    ['POST', '/user/logout', 'POST', '/logout'],
    ['GET', '/backgrounds/unsplash/image/abc/thumb', 'GET', '/backgrounds/unsplash/images/abc/thumb'],
    ['GET', '/user/settings/avatar', 'GET', '/user/settings/avatar/provider'],
    ['POST', '/user/settings/avatar', 'PUT', '/user/settings/avatar/provider'],
    ['POST', '/projects/3/backgrounds/unsplash', 'PUT', '/projects/3/backgrounds/unsplash'],
  ];

  it.each(table)('%s %s -> %s %s on v2', (m, p, m2, p2) => {
    expect(planRoute('v2', m, p)).toEqual({ version: 'v2', method: m2, path: p2 });
  });

  it('changes nothing on v1', () => {
    for (const [m, p] of table) {
      expect(planRoute('v1', m, p)).toEqual({ version: 'v1', method: m, path: p });
    }
  });
});

describe('v1-only routes', () => {
  const pinned: [string, string][] = [
    ['GET', '/user/settings/totp'],
    ['POST', '/user/settings/totp/enroll'],
    ['POST', '/user/settings/totp/enable'],
    ['POST', '/user/settings/totp/disable'],
    ['GET', '/user/settings/totp/qrcode'],
    ['PUT', '/user/settings/avatar/upload'],
    ['GET', '/migration/microsoft-todo/status'],
    // the v1 full-object settings save (fallback when v2 has no PATCH)
    ['POST', '/user/settings/general'],
  ];
  it.each(pinned)('%s %s stays on v1 even for a v2 server', (m, p) => {
    expect(isV1OnlyRoute(m, p)).toBe(true);
    expect(planRoute('v2', m, p)).toEqual({ version: 'v1', method: m, path: p });
  });
  it('does not pin ordinary routes', () => {
    expect(isV1OnlyRoute('GET', '/user')).toBe(false);
    expect(isV1OnlyRoute('GET', '/user/settings/general')).toBe(false);
  });
});

describe('URL helpers', () => {
  it('splits an API URL into root, version, path and query', () => {
    expect(splitApiUrl('https://vk.example/sub/api/v1/tasks/5?x=1')).toEqual({
      root: 'https://vk.example/sub',
      version: 'v1',
      path: '/tasks/5',
      search: '?x=1',
    });
    expect(splitApiUrl('https://vk.example/api/v2')?.path).toBe('');
    expect(splitApiUrl('https://vk.example/other')).toBeNull();
    expect(splitApiUrl('/api/v1/tasks')).toBeNull();
  });

  it('resolveApiCall follows the per-server decision', () => {
    expect(resolveApiCall(ROOT, 'POST', '/user/token/refresh')).toEqual({
      url: `${ROOT}/api/v1/user/token/refresh`,
      method: 'POST',
      version: 'v1',
    });
    setDetectedApiVersion(ROOT, 'v2');
    expect(resolveApiCall(ROOT + '/', 'PUT', '/tasks/1/attachments')).toEqual({
      url: `${ROOT}/api/v2/tasks/1/attachments`,
      method: 'POST',
      version: 'v2',
    });
    expect(resolveApiCall(ROOT, 'GET', '/tasks', '?s=milk&page=2').url).toBe(`${ROOT}/api/v2/tasks?q=milk&page=2`);
  });
});

describe('adaptedFetch', () => {
  const send = vi.fn();
  const problem = (status: number, body: object) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/problem+json' } });
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });

  beforeEach(() => {
    send.mockReset();
  });

  it('passes everything through untouched when the decision is v1', async () => {
    const res = json([{ id: 1 }]);
    send.mockResolvedValue(res);
    const req = new Request(`${ROOT}/api/v1/projects`, { method: 'PUT', body: '{}' });
    await expect(adaptedFetch(req, undefined, send)).resolves.toBe(res);
    expect(send).toHaveBeenCalledWith(req, undefined);
  });

  it('passes a pinned v1-only route through on a v2 server', async () => {
    setDetectedApiVersion(ROOT, 'v2');
    send.mockResolvedValue(json({}));
    const req = new Request(`${ROOT}/api/v1/user/settings/totp/enroll`, { method: 'POST' });
    await adaptedFetch(req, undefined, send);
    expect(send.mock.calls[0]![0]).toBe(req);
  });

  it('moves a v1-shaped Request to /api/v2 with the flipped verb and the same body', async () => {
    setDetectedApiVersion(ROOT, 'v2');
    send.mockResolvedValue(json({ id: 7 }));
    const req = new Request(`${ROOT}/api/v1/projects`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: JSON.stringify({ title: 'P' }),
    });
    await adaptedFetch(req, undefined, send);
    const sent = send.mock.calls[0]![0] as Request;
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe(`${ROOT}/api/v2/projects`);
    expect(sent.headers.get('authorization')).toBe('Bearer t');
    expect(await sent.json()).toEqual({ title: 'P' });
  });

  it('handles the string form used by createApiFetch, keeping a multipart body', async () => {
    setDetectedApiVersion(ROOT, 'v2');
    send.mockResolvedValue(json({}));
    const form = new FormData();
    form.append('files', new Blob(['x']), 'a.txt');
    await adaptedFetch(`${ROOT}/api/v1/tasks/1/attachments`, { method: 'PUT', body: form }, send);
    expect(send).toHaveBeenCalledWith(`${ROOT}/api/v2/tasks/1/attachments`, { method: 'POST', body: form });
  });

  it('renames the search parameter s -> q on v2 only', async () => {
    send.mockResolvedValue(json([]));
    await adaptedFetch(`${ROOT}/api/v1/users?s=jan`, undefined, send);
    expect(send.mock.calls[0]![0]).toBe(`${ROOT}/api/v1/users?s=jan`);
    setDetectedApiVersion(ROOT, 'v2');
    await adaptedFetch(`${ROOT}/api/v1/users?s=jan`, undefined, send);
    expect(send.mock.calls[1]![0]).toBe(`${ROOT}/api/v2/users?q=jan`);
  });

  it('turns the v2 list envelope into the bare array plus pagination headers', async () => {
    setDetectedApiVersion(ROOT, 'v2');
    send.mockResolvedValue(
      json({ $schema: 'x', items: [{ id: 1 }, { id: 2 }], page: 1, per_page: 50, total: 120, total_pages: 3 }),
    );
    const res = await adaptedFetch(`${ROOT}/api/v1/tasks?page=1`, undefined, send);
    expect(await res.json()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(res.headers.get('x-pagination-total-pages')).toBe('3');
    expect(res.headers.get('x-pagination-result-count')).toBe('120');
  });

  it('treats a null items list as empty and leaves non-envelope bodies alone', async () => {
    setDetectedApiVersion(ROOT, 'v2');
    send.mockResolvedValueOnce(json({ items: null, page: 1, per_page: 50, total: 0, total_pages: 0 }));
    expect(await (await adaptedFetch(`${ROOT}/api/v1/labels`, undefined, send)).json()).toEqual([]);
    send.mockResolvedValueOnce(json({ id: 3, title: 'one task' }));
    expect(await (await adaptedFetch(`${ROOT}/api/v1/tasks/3`, undefined, send)).json()).toEqual({ id: 3, title: 'one task' });
  });

  it('only unwraps GET responses', async () => {
    setDetectedApiVersion(ROOT, 'v2');
    const body = { items: [1], total: 1, total_pages: 1 };
    send.mockResolvedValue(json(body));
    const res = await adaptedFetch(`${ROOT}/api/v1/tasks/1/labels/bulk`, { method: 'POST', body: '{}' }, send);
    expect(await res.json()).toEqual(body);
  });

  it('returns a 204 delete as is', async () => {
    setDetectedApiVersion(ROOT, 'v2');
    send.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await adaptedFetch(`${ROOT}/api/v1/tasks/1`, { method: 'DELETE' }, send);
    expect(res.status).toBe(204);
    expect(send.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' });
  });

  it('maps problem+json to { code, message } (detail first, then title)', async () => {
    setDetectedApiVersion(ROOT, 'v2');
    send.mockResolvedValueOnce(problem(404, { title: 'Not Found', status: 404, detail: 'The task does not exist.', code: 4002 }));
    let res = await adaptedFetch(`${ROOT}/api/v1/tasks/1`, undefined, send);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 4002, message: 'The task does not exist.' });
    send.mockResolvedValueOnce(problem(500, { title: 'Internal Server Error', status: 500 }));
    res = await adaptedFetch(`${ROOT}/api/v1/tasks/1`, undefined, send);
    expect(await res.json()).toMatchObject({ message: 'Internal Server Error' });
  });
});

describe('errors', () => {
  it('buildApiError reads a v2 problem body: detail, numeric code, field errors', () => {
    const err = buildApiError(422, {
      title: 'Unprocessable Entity',
      detail: 'validation failed',
      code: 2002,
      errors: [{ location: 'body.title', message: 'required' }],
    });
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.code).toBe(2002);
    expect(err.message).toBe('validation failed');
    expect(err.fieldErrors).toHaveLength(1);
    expect(err.retryable).toBe(false);
  });
  it('falls back to the title, then to the status', () => {
    expect(buildApiError(400, { title: 'Bad Request' }).message).toBe('Bad Request');
    expect(buildApiError(400, {}).message).toBe('HTTP 400');
  });
  it('keeps v1 bodies working', () => {
    const err = buildApiError(412, { code: 1017, message: 'Invalid totp passcode.' });
    expect(err.message).toBe('Invalid totp passcode.');
    expect(err.fieldErrors).toEqual([]);
  });
  it('detects TOTP-required on 412 or code 1017, but not on a plain 422', () => {
    expect(isTotpRequired(new ApiError(412, 1017, 'x', false))).toBe(true);
    expect(isTotpRequired(new ApiError(412, null, 'x', false))).toBe(true);
    expect(isTotpRequired(new ApiError(401, 1017, 'x', false))).toBe(true);
    expect(isTotpRequired(new ApiError(422, 2002, 'x', false))).toBe(false);
    expect(isTotpRequired(new Error('x'))).toBe(false);
  });
});

describe('sendMergePatch', () => {
  const res = (status: number, data?: unknown, error?: unknown) =>
    ({ data, error, response: { status, ok: status >= 200 && status < 300 } as Response });

  it('returns the updated resource', async () => {
    await expect(sendMergePatch(async () => res(200, { id: 1, updated: 'u' }))).resolves.toEqual({ id: 1, updated: 'u' });
  });
  it('returns null for 304 (nothing changed) and for a body-less success', async () => {
    await expect(sendMergePatch(async () => res(304))).resolves.toBeNull();
    await expect(sendMergePatch(async () => res(200))).resolves.toBeNull();
  });
  it.each([404, 405, 501])('reports %i as unavailable so the caller falls back', async (status) => {
    await expect(sendMergePatch(async () => res(status))).resolves.toBe('unavailable');
  });
  it('throws an ApiError otherwise', async () => {
    await expect(sendMergePatch(async () => res(422, undefined, { detail: 'bad', code: 2002 }))).rejects.toMatchObject({
      status: 422,
      code: 2002,
      message: 'bad',
    });
  });
});
