// @vitest-environment jsdom
/**
 * saveUserSettings against a fake Vikunja that models both settings writes
 * the way upstream implements them, driven through the real API layer
 * (createApiClient / createApiFetch → platformFetch → fetch):
 *
 * - v1 `POST /api/v1/user/settings/general` (UpdateGeneralUserSettings →
 *   models.UpdateUserGeneralSettings): every writable field is copied from
 *   the body, so an omitted one is written back as its Go zero value.
 * - v2 `PATCH /api/v2/user/settings/general` (v2.7.0+, Huma's AutoPatch over
 *   the GET and PUT on that path): read the stored settings, apply the body
 *   as an RFC 7386 merge-patch, answer an empty 304 if nothing changed, else
 *   hand the merged object to the PUT, which writes it like v1 does.
 *
 * Older servers: before v2.4.0 there is no /api/v2 at all (404); v2.4.0 to
 * v2.6.0 have the PUT but no GET on that path, so no PATCH (405).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Json = Record<string, unknown>;

const { auth, getCachedUser } = vi.hoisted(() => ({
  auth: { serverUrl: 'https://vk.example' },
  getCachedUser: vi.fn(),
}));
vi.mock('@/db/user', () => ({ getCachedUser }));
vi.mock('@/auth/store', () => ({
  useAuth: {
    getState: () => ({
      status: { kind: 'authenticated', credentials: { serverUrl: auth.serverUrl, token: 'tk_test', authMethod: 'token' } },
      signOut: vi.fn(),
    }),
  },
  getAuthSnapshot: () => ({ serverUrl: auth.serverUrl, token: 'tk_test' }),
}));

import { maybeHydrateSyncedPrefs, pushSyncedPrefs, saveUserSettings } from '@/sync/settingsSync';
import { useSettings } from '@/stores/settings';
import { _resetResilience } from '@/api/resilience';

/** Go zero values of models.UserGeneralSettings' writable fields. */
const GO_ZERO: Json = {
  name: '',
  email_reminders_enabled: false,
  discoverable_by_name: false,
  discoverable_by_email: false,
  overdue_tasks_reminders_enabled: false,
  overdue_tasks_reminders_time: '',
  default_project_id: 0,
  week_start: 0,
  language: '',
  timezone: '',
  frontend_settings: null,
};

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** RFC 7386 MergePatch, as written in the RFC. */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch;
  const out: Json = isObject(target) ? { ...target } : {};
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) delete out[name];
    else out[name] = mergePatch(out[name], value);
  }
  return out;
}

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });

interface Call {
  method: string;
  path: string;
  contentType: string | null;
  body: Json | null;
}

class FakeVikunja {
  settings: Json;
  /** 'v2.7': has the PATCH. 'v2.4': /api/v2 without it (405). 'v1-only': no /api/v2 (404). */
  release: 'v2.7' | 'v2.4' | 'v1-only' = 'v2.7';
  calls: Call[] = [];
  /** Runs when a settings write arrives, before the server applies it. */
  beforeWrite: (() => void) | null = null;
  /** Forces the response to the next PATCH. */
  nextPatchResponse: (() => Response) | null = null;
  /** While set, a PATCH waits for it before the server handles it. */
  hold: Promise<void> | null = null;

  constructor(settings: Json) {
    this.settings = structuredClone(settings);
  }

  /** UpdateUserGeneralSettings: every writable field comes from the body. */
  private write(body: Json): Response | null {
    const ws = body.week_start;
    if (typeof ws === 'number' && (ws < 0 || ws > 6)) return null;
    const next: Json = {};
    for (const key of Object.keys(GO_ZERO)) next[key] = body[key] ?? GO_ZERO[key];
    this.settings = next;
    return json({ message: 'The settings were updated successfully.' });
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (req?.method ?? init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(req ? req.headers : init?.headers);
    const text = req ? await req.text() : typeof init?.body === 'string' ? init.body : '';
    const body = text ? (JSON.parse(text) as Json) : null;
    this.calls.push({ method, path: url.pathname, contentType: headers.get('content-type'), body });

    if (method === 'GET' && url.pathname === '/api/v1/user') {
      return json({ id: 1, username: 'jake', name: this.settings.name, settings: structuredClone(this.settings) });
    }
    if (method === 'POST' && url.pathname === '/api/v1/user/settings/general') {
      this.beforeWrite?.();
      return this.write(body ?? {}) ?? json({ code: 2002, message: 'Invalid data' }, 400);
    }
    if (url.pathname.startsWith('/api/v2/')) {
      if (this.release === 'v1-only') return json({ message: 'Not Found' }, 404);
      if (url.pathname === '/api/v2/user/settings/general' && method === 'PATCH') {
        if (this.release === 'v2.4') return json({ message: 'Method Not Allowed' }, 405);
        if (this.hold) await this.hold;
        const forced = this.nextPatchResponse;
        this.nextPatchResponse = null;
        if (forced) return forced();
        if (headers.get('content-type') !== 'application/merge-patch+json') return json({}, 415);
        this.beforeWrite?.();
        const current = structuredClone(this.settings);
        const merged = mergePatch(current, body) as Json;
        if (JSON.stringify(merged) === JSON.stringify(current)) return new Response(null, { status: 304 });
        return (
          this.write(merged) ??
          json({ status: 422, title: 'Unprocessable Entity', detail: 'week_start: does not validate' }, 422, 'application/problem+json')
        );
      }
    }
    return json({ message: 'Not Found' }, 404);
  };

  /** Requests other than the setup reads, as `METHOD path`. */
  get trail(): string[] {
    return this.calls.map((c) => `${c.method} ${c.path}`);
  }
}

const INITIAL: Json = {
  name: 'Jake',
  email_reminders_enabled: true,
  discoverable_by_name: true,
  discoverable_by_email: false,
  overdue_tasks_reminders_enabled: true,
  overdue_tasks_reminders_time: '08:30',
  default_project_id: 7,
  week_start: 1,
  language: 'de',
  timezone: 'Europe/Berlin',
  frontend_settings: {
    quick_add_magic_mode: 'vikunja',
    color_schema: 'dark',
    sidebar_width: 300,
    otherClient: { theme: 'x', list: [1, 2] },
    cria: { dateFormat: 'DD/MM/YYYY', colorScheme: 'light' },
  },
};

let vk: FakeVikunja;
const frontend = () => vk.settings.frontend_settings as Json;

/** A save from Vikunja-web (or anything else) that lands on the server directly. */
function webSave(patch: Json) {
  vk.settings = mergePatch(vk.settings, patch) as Json;
}

beforeEach(() => {
  auth.serverUrl = 'https://vk.example';
  _resetResilience();
  globalThis.__cria_settingsHydrated__ = undefined;
  globalThis.__cria_serverQuickAddMode__ = undefined;
  globalThis.__cria_settingsSaveChain__ = undefined;
  globalThis.__cria_settingsPatchUnsupported__ = undefined;
  useSettings.setState({ quickAddMagicMode: 'vikunja', colorScheme: 'system', dateFormat: 'YYYY-MM-DD' });
  vk = new FakeVikunja(INITIAL);
  vi.stubGlobal('fetch', vk.fetch);
  getCachedUser.mockResolvedValue({ raw: { settings: structuredClone(INITIAL) } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveUserSettings on a server with the v2 PATCH (v2.7.0+)', () => {
  it('sends only the changed fields as a merge-patch: no read, no full POST', async () => {
    await saveUserSettings({ settings: { name: 'Jacob' } });
    expect(vk.trail).toEqual(['PATCH /api/v2/user/settings/general']);
    expect(vk.calls[0]).toMatchObject({ contentType: 'application/merge-patch+json', body: { name: 'Jacob' } });
    expect(vk.settings).toEqual({ ...INITIAL, name: 'Jacob' });
  });

  it("keeps a web save that lands while Cria's save is in flight", async () => {
    // The v1 path's lost update: the web writes between Cria's read and write.
    vk.beforeWrite = () => {
      vk.beforeWrite = null;
      webSave({ week_start: 0, language: 'fr', frontend_settings: { quick_add_magic_mode: 'todoist', sidebar_width: 400 } });
    };
    useSettings.getState().setColorScheme('dark');
    await pushSyncedPrefs(['colorScheme']);

    expect(vk.settings).toMatchObject({ week_start: 0, language: 'fr', name: 'Jake', default_project_id: 7 });
    expect(frontend()).toMatchObject({ quick_add_magic_mode: 'todoist', sidebar_width: 400 });
    expect(frontend().cria).toEqual({ dateFormat: 'DD/MM/YYYY', colorScheme: 'dark' });
  });

  it("keeps a web change Cria hasn't seen yet when it saves from a stale view", async () => {
    maybeHydrateSyncedPrefs({ raw: { settings: structuredClone(INITIAL) } } as never);
    webSave({ timezone: 'UTC', frontend_settings: { quick_add_magic_mode: 'disabled', new_web_key: true } });

    await saveUserSettings({ settings: { week_start: 3 } });

    expect(vk.settings).toMatchObject({ week_start: 3, timezone: 'UTC' });
    expect(frontend()).toMatchObject({ quick_add_magic_mode: 'disabled', new_web_key: true });
  });

  it("changes one Cria pref without touching other clients' keys or its sibling prefs", async () => {
    await saveUserSettings({ cria: { colorScheme: 'dark' } });
    expect(vk.calls[0]!.body).toEqual({ frontend_settings: { cria: { colorScheme: 'dark' } } });
    expect(frontend()).toEqual({
      ...(INITIAL.frontend_settings as Json),
      cria: { dateFormat: 'DD/MM/YYYY', colorScheme: 'dark' },
    });
  });

  it("sets web's Quick Add Magic key alone and remembers the mode it wrote", async () => {
    await saveUserSettings({ frontend: { quick_add_magic_mode: 'todoist' } });
    expect(vk.calls[0]!.body).toEqual({ frontend_settings: { quick_add_magic_mode: 'todoist' } });
    expect(frontend()).toEqual({ ...(INITIAL.frontend_settings as Json), quick_add_magic_mode: 'todoist' });
    expect(globalThis.__cria_serverQuickAddMode__).toBe('todoist');
  });

  it('never sends a null, so a save cannot delete a stored key', async () => {
    await saveUserSettings({ frontend: { color_schema: null }, cria: { dateFormat: null, colorScheme: 'dark' } });
    expect(vk.calls[0]!.body).toEqual({ frontend_settings: { cria: { colorScheme: 'dark' } } });
    expect(frontend()).toMatchObject({ color_schema: 'dark', cria: { dateFormat: 'DD/MM/YYYY', colorScheme: 'dark' } });
  });

  it('creates frontend_settings when the server has none', async () => {
    vk.settings.frontend_settings = null;
    await saveUserSettings({ cria: { colorScheme: 'dark' } });
    expect(vk.settings.frontend_settings).toEqual({ cria: { colorScheme: 'dark' } });
    expect(vk.settings).toMatchObject({ name: 'Jake', week_start: 1 });
  });

  it('treats the empty 304 for a no-op patch as saved', async () => {
    await expect(saveUserSettings({ settings: { name: 'Jake' } })).resolves.toBeUndefined();
    expect(vk.trail).toEqual(['PATCH /api/v2/user/settings/general']);
  });

  it('runs saves one at a time, each on top of the last', async () => {
    let release!: () => void;
    vk.hold = new Promise<void>((r) => (release = r));
    const a = saveUserSettings({ cria: { colorScheme: 'dark' } });
    const b = saveUserSettings({ cria: { dateFormat: 'YYYY-MM-DD' } });
    await vi.waitFor(() => expect(vk.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(vk.calls).toHaveLength(1); // b waits for a
    vk.hold = null;
    release();
    await Promise.all([a, b]);
    expect(vk.trail).toEqual(['PATCH /api/v2/user/settings/general', 'PATCH /api/v2/user/settings/general']);
    expect(frontend().cria).toEqual({ dateFormat: 'YYYY-MM-DD', colorScheme: 'dark' });
  });

  it('surfaces a rejected patch without falling back to v1', async () => {
    await expect(saveUserSettings({ settings: { week_start: 9 } })).rejects.toMatchObject({
      status: 422,
      message: 'week_start: does not validate',
    });
    expect(vk.trail).toEqual(['PATCH /api/v2/user/settings/general']);
    expect(vk.settings).toEqual(INITIAL);
    // Not mistaken for a missing endpoint: the next save patches again.
    await saveUserSettings({ settings: { week_start: 2 } });
    expect(vk.trail.at(-1)).toBe('PATCH /api/v2/user/settings/general');
    expect(vk.settings.week_start).toBe(2);
  });

  it('sends nothing more when the patch fails on the network, and patches again next time', async () => {
    vk.nextPatchResponse = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(saveUserSettings({ settings: { name: 'X' } })).rejects.toThrow('Failed to fetch');
    expect(vk.trail).toEqual(['PATCH /api/v2/user/settings/general']);

    await saveUserSettings({ settings: { name: 'Y' } });
    expect(vk.trail).toEqual(['PATCH /api/v2/user/settings/general', 'PATCH /api/v2/user/settings/general']);
    expect(vk.settings.name).toBe('Y');
  });
});

describe('saveUserSettings on a server without the v2 PATCH', () => {
  it.each([
    ['v2.4.0 to v2.6.0 (405)', 'v2.4'],
    ['before v2.4.0 (404)', 'v1-only'],
  ] as const)('%s: falls back to the unchanged v1 read, merge, full POST', async (_label, release) => {
    vk.release = release;
    webSave({ frontend_settings: { new_web_key: true } });
    await saveUserSettings({ cria: { colorScheme: 'dark' } });

    expect(vk.trail).toEqual([
      'PATCH /api/v2/user/settings/general',
      'GET /api/v1/user',
      'POST /api/v1/user/settings/general',
    ]);
    // The whole object, every field as the server held it, only the change applied.
    const post = vk.calls[2]!.body!;
    expect(post).toMatchObject({ ...INITIAL, frontend_settings: expect.any(Object) });
    expect(post.frontend_settings).toEqual({
      ...(INITIAL.frontend_settings as Json),
      new_web_key: true,
      cria: { dateFormat: 'DD/MM/YYYY', colorScheme: 'dark' },
    });
    expect(vk.settings).toEqual(post);
  });

  it('remembers the server has no PATCH: later saves go straight to v1', async () => {
    vk.release = 'v2.4';
    await saveUserSettings({ settings: { name: 'A' } });
    await saveUserSettings({ settings: { week_start: 3 } });
    expect(vk.trail).toEqual([
      'PATCH /api/v2/user/settings/general',
      'GET /api/v1/user',
      'POST /api/v1/user/settings/general',
      'GET /api/v1/user',
      'POST /api/v1/user/settings/general',
    ]);
    expect(vk.settings).toMatchObject({ name: 'A', week_start: 3, language: 'de', default_project_id: 7 });
  });

  it('remembers it per server URL', async () => {
    vk.release = 'v1-only';
    await saveUserSettings({ settings: { name: 'A' } });

    auth.serverUrl = 'https://other.example/';
    vk.release = 'v2.7';
    vk.calls = [];
    await saveUserSettings({ settings: { name: 'B' } });
    expect(vk.trail).toEqual(['PATCH /api/v2/user/settings/general']);
  });

  it.each([
    ['a 501 from a proxy', () => json({ message: 'Not Implemented' }, 501)],
    ['a 2xx that is not JSON', () => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
  ])('falls back on %s', async (_label, response) => {
    vk.nextPatchResponse = response;
    await saveUserSettings({ settings: { name: 'Jacob' } });
    expect(vk.trail).toEqual([
      'PATCH /api/v2/user/settings/general',
      'GET /api/v1/user',
      'POST /api/v1/user/settings/general',
    ]);
    expect(vk.settings).toEqual({ ...INITIAL, name: 'Jacob' });
  });

  it('sends nothing when the v1 read fails', async () => {
    vk.release = 'v1-only';
    const realFetch = vk.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/user')) return json({ message: 'boom' }, 500);
      return realFetch(input, init);
    });
    await expect(saveUserSettings({ settings: { name: 'X' } })).rejects.toMatchObject({ status: 500 });
    expect(vk.trail).toEqual(['PATCH /api/v2/user/settings/general']);
    expect(vk.settings).toEqual(INITIAL);
  });
});
