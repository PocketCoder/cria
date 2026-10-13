/**
 * The single owner of every Vikunja v1/v2 difference (contract:
 * docs/V2-MIGRATION.md).
 *
 * Callers keep writing v1-shaped calls through the typed v1 client
 * (`createApiClient`, `createApiFetch`): `PUT` creates, `POST` updates, `s` is
 * the search parameter, lists are bare arrays with `x-pagination-*` headers,
 * errors are `{ code, message }`. When the decision for the server is v2
 * (apiVersion.ts), {@link adaptedFetch} translates each request on the way out
 * and each response on the way back, so nothing above this file knows which
 * generation answered:
 *
 * - base URL `/api/v1` -> `/api/v2`, except routes in {@link V1_ONLY_ROUTES}
 * - verbs: create `PUT` -> `POST`, update `POST` -> `PUT`, except the routes in
 *   {@link SAME_VERB_ROUTES}
 * - renamed paths ({@link V2_REWRITES}) and `s` -> `q`
 * - list envelope `{ items, total, total_pages, ... }` -> the bare array plus
 *   `x-pagination-total-pages` / `x-pagination-result-count`
 * - `application/problem+json` -> `{ ...problem, message: detail ?? title }`,
 *   so `buildApiError` and every `err.message` reader keep working
 * - 204 deletes need no handling (nothing parses an empty body)
 *
 * With v1 (or a pinned route) the request and response pass through untouched.
 * v2 `PUT` is a full replace, so genuinely partial updates (tasks, projects,
 * team rename) do not go through the verb flip: they use {@link sendMergePatch}.
 */
import { getApiVersion, type ApiVersion } from './apiVersion';
import { buildApiError } from './errors';

type Send = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface RouteRule {
  /** v1 method, upper case. Omitted: any method. */
  method?: string;
  /** Matches the path after `/api/v1`, query string excluded. */
  path: RegExp;
}

/**
 * Routes with no v2 equivalent: they stay on `/api/v1` even on a v2 server.
 * Auth is identical on both generations, so the same Bearer token works.
 * The one place to list them.
 */
export const V1_ONLY_ROUTES: readonly RouteRule[] = [
  // TOTP management has no v2 route group in the OpenAPI document.
  { path: /^\/user\/settings\/totp(\/|$)/ },
  // v2 replaced the upload with `PUT /user/settings/avatar` (multipart, different shape).
  { path: /^\/user\/settings\/avatar\/upload$/ },
  { path: /^\/migration\/microsoft-todo(\/|$)/ },
  { path: /^\/auth\/openid\// },
  // The v1 full-object settings save is the fallback for servers whose v2 has
  // no settings PATCH (see settingsSync); it must stay a v1 POST, never a v2 PUT.
  { method: 'POST', path: /^\/user\/settings\/general$/ },
];

/** v1 routes whose verb did not change in v2 (so the PUT/POST flip skips them). */
export const SAME_VERB_ROUTES: readonly RouteRule[] = [
  { method: 'POST', path: /^\/(login|register)$/ },
  { method: 'POST', path: /^\/user\/token(\/refresh)?$/ },
  { method: 'POST', path: /^\/shares\/[^/]+\/auth$/ },
  { method: 'POST', path: /^\/notifications$/ },
  { method: 'POST', path: /^\/teams\/[^/]+\/members\/[^/]+\/admin$/ },
  { method: 'POST', path: /^\/[^/]+\/[^/]+\/reactions\/delete$/ },
  { method: 'POST', path: /^\/user\/(confirm|password|export|deletion)(\/|$)/ },
  { method: 'POST', path: /^\/oauth\// },
  { method: 'POST', path: /^\/admin\/users$/ },
  { method: 'POST', path: /^\/migration\/(todoist|trello|vikunja-file)\/(migrate|auth)$/ },
  // v1 already uploads backgrounds with PUT.
  { method: 'PUT', path: /^\/projects\/[^/]+\/backgrounds\/upload$/ },
];

interface Rewrite {
  method?: string;
  path: RegExp;
  to: (m: RegExpExecArray) => string;
  /** Overrides the flipped method. */
  newMethod?: string;
}

/** v1 paths that were renamed in v2 (the match is on the v1 path). */
const V2_REWRITES: readonly Rewrite[] = [
  { method: 'GET', path: /^\/projects\/([^/]+)\/projectusers$/, to: (m) => `/projects/${m[1]}/users/search` },
  { method: 'POST', path: /^\/user\/logout$/, to: () => '/logout', newMethod: 'POST' },
  { method: 'GET', path: /^\/backgrounds\/unsplash\/image\/(.+)$/, to: (m) => `/backgrounds/unsplash/images/${m[1]}` },
  { method: 'GET', path: /^\/([^/]+)\/avatar$/, to: (m) => `/avatar/${m[1]}` },
  // The avatar provider moved to its own v2 sub-route (`PUT /user/settings/avatar` is the upload there).
  { method: 'GET', path: /^\/user\/settings\/avatar$/, to: () => '/user/settings/avatar/provider' },
  { method: 'POST', path: /^\/user\/settings\/avatar$/, to: () => '/user/settings/avatar/provider', newMethod: 'PUT' },
];

function matches(rules: readonly RouteRule[], method: string, path: string): boolean {
  return rules.some((r) => (!r.method || r.method === method) && r.path.test(path));
}

/** True if this v1 route is always called over `/api/v1`. */
export function isV1OnlyRoute(method: string, path: string): boolean {
  return matches(V1_ONLY_ROUTES, method.toUpperCase(), path);
}

export interface RoutePlan {
  version: ApiVersion;
  method: string;
  path: string;
}

/** Plan a v1-shaped call (method + path after the base) for the given version. */
export function planRoute(version: ApiVersion, v1Method: string, v1Path: string): RoutePlan {
  const method = v1Method.toUpperCase();
  if (version === 'v1' || isV1OnlyRoute(method, v1Path)) {
    return { version: 'v1', method, path: v1Path };
  }
  let path = v1Path;
  let rewrite: Rewrite | undefined;
  for (const r of V2_REWRITES) {
    if (r.method && r.method !== method) continue;
    const m = r.path.exec(v1Path);
    if (m) {
      rewrite = r;
      path = r.to(m);
      break;
    }
  }
  let v2Method = method;
  if (rewrite?.newMethod) v2Method = rewrite.newMethod;
  else if (!matches(SAME_VERB_ROUTES, method, v1Path)) {
    if (method === 'PUT') v2Method = 'POST';
    else if (method === 'POST') v2Method = 'PUT';
  }
  return { version: 'v2', method: v2Method, path };
}

/* ───────────────────────── URL helpers ───────────────────────── */

const API_SEGMENT = /\/api\/v[12](?=\/|$|\?)/;

export interface ApiUrlParts {
  /** Server root without trailing slash, e.g. `https://vk.example/sub`. */
  root: string;
  /** The version in the URL as written. */
  version: ApiVersion;
  /** Path after `/api/vN`, e.g. `/tasks/5`. Empty for the base itself. */
  path: string;
  search: string;
}

/** Split an absolute API URL; null if it has no `/api/v1` or `/api/v2` segment. */
export function splitApiUrl(url: string): ApiUrlParts | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = API_SEGMENT.exec(u.pathname);
  if (!m) return null;
  return {
    root: `${u.origin}${u.pathname.slice(0, m.index)}`,
    version: m[0].endsWith('v2') ? 'v2' : 'v1',
    path: u.pathname.slice(m.index + m[0].length),
    search: u.search,
  };
}

/** `s` -> `q` (v2 renamed the search parameter). */
function rewriteSearch(search: string): string {
  if (!search) return search;
  const params = new URLSearchParams(search);
  if (!params.has('s') || params.has('q')) return search;
  const out = new URLSearchParams();
  for (const [k, v] of params) out.append(k === 's' ? 'q' : k, v);
  return `?${out.toString()}`;
}

/**
 * Resolve a v1-shaped call to the URL and method to send, for callers that
 * build their own request (multipart uploads, blob downloads).
 */
export function resolveApiCall(
  serverUrl: string,
  v1Method: string,
  v1Path: string,
  query = '',
): { url: string; method: string; version: ApiVersion } {
  const root = serverUrl.replace(/\/+$/, '');
  const plan = planRoute(getApiVersion(root), v1Method, v1Path);
  const search = plan.version === 'v2' ? rewriteSearch(query) : query;
  return { url: `${root}/api/${plan.version}${plan.path}${search}`, method: plan.method, version: plan.version };
}

/* ───────────────────────── response mapping ───────────────────────── */

function isJson(res: Response): boolean {
  return /json/i.test(res.headers.get('content-type') ?? '');
}

function withBody(res: Response, body: string, extra?: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('content-type', 'application/json');
  for (const [k, v] of Object.entries(extra ?? {})) headers.set(k, v);
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

interface Envelope {
  items?: unknown;
  total?: unknown;
  total_pages?: unknown;
}

function isEnvelope(b: unknown): b is Envelope {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  const e = b as Envelope;
  return (Array.isArray(e.items) || e.items === null) && typeof e.total_pages === 'number';
}

/** v2 problem+json -> `{ code, message }` plus the original fields. */
async function normaliseError(res: Response): Promise<Response> {
  if (!isJson(res)) return res;
  let text: string;
  try {
    text = await res.clone().text();
  } catch {
    return res;
  }
  let problem: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return res;
    problem = parsed as Record<string, unknown>;
  } catch {
    return res;
  }
  const pick = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
  const message = pick(problem.detail) ?? pick(problem.title) ?? pick(problem.message);
  return withBody(res, JSON.stringify({ ...problem, ...(message ? { message } : {}) }));
}

/** v2 list envelope -> bare array + the v1 pagination headers. */
async function unwrapEnvelope(res: Response): Promise<Response> {
  if (!isJson(res)) return res;
  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    return res;
  }
  if (!isEnvelope(body)) return res;
  const items = Array.isArray(body.items) ? body.items : [];
  const total = typeof body.total === 'number' ? body.total : items.length;
  return withBody(res, JSON.stringify(items), {
    'x-pagination-total-pages': String(body.total_pages),
    'x-pagination-result-count': String(total),
  });
}

/** Map a response from a call that was sent to v2. */
export async function adaptResponse(res: Response, method: string): Promise<Response> {
  if (res.status >= 400) return normaliseError(res);
  if (res.ok && method === 'GET') return unwrapEnvelope(res);
  return res;
}

/* ───────────────────────── request mapping ───────────────────────── */

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function inputMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

/**
 * A fetch that speaks v2 to servers decided as v2 (see the file header).
 * `send` is the underlying transport (`platformFetch`, which also does the
 * 401 refresh-and-retry). URLs without an `/api/v1` segment, and everything
 * when the decision is v1, pass straight through.
 */
export async function adaptedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  send: Send,
): Promise<Response> {
  const parts = splitApiUrl(inputUrl(input));
  if (!parts || parts.version !== 'v1') return send(input, init);
  const version = getApiVersion(parts.root);
  if (version === 'v1') return send(input, init);
  const plan = planRoute(version, inputMethod(input, init), parts.path);
  if (plan.version === 'v1') return send(input, init);

  const url = `${parts.root}/api/v2${plan.path}${rewriteSearch(parts.search)}`;
  let res: Response;
  if (input instanceof Request) {
    const hasBody = input.body !== null && plan.method !== 'GET' && plan.method !== 'HEAD';
    const body = hasBody ? await input.clone().arrayBuffer() : undefined;
    res = await send(
      new Request(url, { method: plan.method, headers: input.headers, body, signal: input.signal }),
      init,
    );
  } else {
    res = await send(url, { ...init, method: plan.method });
  }
  return adaptResponse(res, plan.method);
}

/* ───────────────────────── partial updates ───────────────────────── */

export const MERGE_PATCH = 'application/merge-patch+json';

/** Statuses meaning the PATCH did not apply, so the caller falls back to the v1-shaped call. */
const PATCH_UNAVAILABLE = new Set([404, 405, 501]);

/**
 * Send a genuinely partial update as a v2 merge-patch (RFC 7386): the body
 * names only the fields to change, and the server merges it into what it holds
 * (Huma's AutoPatch: GET, merge, then the PUT), so fields the client does not
 * track survive. `call` performs the request through the API client (an
 * openapi-fetch `client.request('PATCH', ...)` result), so the base URL, token
 * and error mapping are the client's. Returns the updated resource, `null` for
 * the empty 304 (nothing changed) and `'unavailable'` when the server has no
 * PATCH for the route (the caller then uses the v1-shaped call). Anything
 * else throws an ApiError.
 */
export async function sendMergePatch(
  call: () => Promise<{ data?: unknown; error?: unknown; response: Response }>,
): Promise<Record<string, unknown> | null | 'unavailable'> {
  const { data, error, response } = await call();
  if (response.status === 304) return null;
  if (PATCH_UNAVAILABLE.has(response.status)) return 'unavailable';
  if (!response.ok) throw buildApiError(response.status, error);
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}
