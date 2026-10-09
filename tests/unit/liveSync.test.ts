import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The live path must never notify() itself. Mocked so a stray call is caught
// even if one were added behind an import this file doesn't know about.
const bus = vi.hoisted(() => ({ notify: vi.fn(), subscribe: vi.fn() }));
vi.mock('@/db/bus', () => bus);

import {
  authFrame,
  backoffDelay,
  createLiveClient,
  createLiveHandlers,
  createPlanRunner,
  executePlan,
  getLiveSyncStatus,
  jwtExpiresAt,
  liveUrl,
  looksLikeJwt,
  mergePlans,
  parseFrame,
  planFor,
  startLiveSync,
  stopLiveSync,
  subscribeFrame,
  supportsLiveSync,
  type LiveActions,
  type LiveClientDeps,
  type LivePlan,
  type LiveSocket,
  type LiveTransport,
  type TransportEvent,
} from '@/sync/liveSync';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-09T12:00:00Z').getTime();

function jwt(expMs: number): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64({ type: 1, id: 1, exp: Math.floor(expMs / 1000) })}.sig`;
}
const FRESH_TOKEN = jwt(NOW + 10 * 60_000);

class FakeSocket implements LiveSocket {
  sent: string[] = [];
  closed = false;
  async send(text: string) {
    this.sent.push(text);
  }
  async close() {
    this.closed = true;
  }
}

interface Conn {
  url: string;
  socket: FakeSocket;
  emit: (e: TransportEvent) => void;
}

class FakeTransport implements LiveTransport {
  conns: Conn[] = [];
  attempts = 0;
  /** Errors to throw from the next connect() calls, in order. */
  failures: Error[] = [];
  async connect(url: string, onEvent: (e: TransportEvent) => void) {
    this.attempts++;
    const err = this.failures.shift();
    if (err) throw err;
    const socket = new FakeSocket();
    this.conns.push({ url, socket, emit: onEvent });
    return socket;
  }
  get last(): Conn {
    return this.conns[this.conns.length - 1]!;
  }
}

const json = (o: unknown): TransportEvent => ({ type: 'text', data: JSON.stringify(o) });
const AUTH_OK = json({ action: 'auth.success', success: true });
const note = (name: string, notification: unknown, id = 7) =>
  json({ event: 'notification.created', data: { id, name, notification } });
/** Let queued promise continuations (connect, send) run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

interface Harness {
  client: ReturnType<typeof createLiveClient>;
  transport: FakeTransport;
  deps: LiveClientDeps;
  visible: { value: boolean };
  token: { value: string | null | undefined };
  onNotification: ReturnType<typeof vi.fn>;
  onResync: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
}

function harness(over: Partial<LiveClientDeps> = {}): Harness {
  const transport = new FakeTransport();
  const visible = { value: true };
  // undefined = a fresh 10 minute JWT minted on demand, so tests that advance
  // the fake clock a long way don't end up holding an expired one.
  const token = { value: undefined as string | null | undefined };
  const onNotification = vi.fn();
  const onResync = vi.fn();
  const refresh = vi.fn(async () => null as string | null);
  const deps: LiveClientDeps = {
    transport,
    url: () => 'wss://vk.test/api/v1/ws',
    token: () => (token.value === undefined ? jwt(Date.now() + 10 * 60_000) : token.value),
    refresh,
    isVisible: () => visible.value,
    pauseWhenHidden: false,
    onNotification,
    onResync,
    // jitter factor 1.0, so delays are exactly the base
    random: () => 0.5,
    ...over,
  };
  return { client: createLiveClient(deps), transport, deps, visible, token, onNotification, onResync, refresh };
}

/** Start and run the handshake to `live`. */
async function goLive(h: Harness): Promise<Conn> {
  h.client.start();
  await settle();
  const conn = h.transport.last;
  conn.emit(AUTH_OK);
  await settle();
  return conn;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  bus.notify.mockClear();
});

afterEach(() => {
  stopLiveSync();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('supportsLiveSync', () => {
  it('rejects versions that predate /ws (2.3.0)', () => {
    for (const v of ['2.2.2', 'v2.2.2', '1.0.0', '0.24.6']) expect(supportsLiveSync(v)).toBe(false);
  });
  it('accepts 2.3.0 and later', () => {
    for (const v of ['2.3.0', 'v2.7.0', '2.10.1', '3.0.0']) expect(supportsLiveSync(v)).toBe(true);
  });
  it('treats an unknown or unparseable version as worth trying', () => {
    for (const v of [null, undefined, '', 'dev', 'main-abc123']) expect(supportsLiveSync(v)).toBe(true);
  });
});

describe('liveUrl', () => {
  it('maps https to wss on the v1 route', () => {
    expect(liveUrl('https://vk.example.com')).toBe('wss://vk.example.com/api/v1/ws');
    expect(liveUrl('https://vk.example.com/')).toBe('wss://vk.example.com/api/v1/ws');
    expect(liveUrl('https://example.com/vikunja/')).toBe('wss://example.com/vikunja/api/v1/ws');
  });
  it('allows plaintext only for loopback', () => {
    expect(liveUrl('http://localhost:3456')).toBe('ws://localhost:3456/api/v1/ws');
    expect(liveUrl('http://127.0.0.1:3456')).toBe('ws://127.0.0.1:3456/api/v1/ws');
    expect(liveUrl('http://vk.example.com')).toBeNull();
  });
  it('returns null for nothing usable', () => {
    expect(liveUrl(null)).toBeNull();
    expect(liveUrl('')).toBeNull();
    expect(liveUrl('not a url')).toBeNull();
    expect(liveUrl('ftp://vk.example.com')).toBeNull();
  });
});

describe('token helpers', () => {
  it('recognises JWTs and not API tokens', () => {
    expect(looksLikeJwt(FRESH_TOKEN)).toBe(true);
    expect(looksLikeJwt('tk_0123456789abcdef')).toBe(false);
    expect(looksLikeJwt('')).toBe(false);
    expect(looksLikeJwt(null)).toBe(false);
  });
  it('reads exp in ms', () => {
    expect(jwtExpiresAt(jwt(NOW + 5000))).toBe(NOW + 5000);
  });
  it('returns null when exp is unreadable', () => {
    expect(jwtExpiresAt('tk_abc')).toBeNull();
    expect(jwtExpiresAt('a.b.c')).toBeNull();
  });
});

describe('parseFrame', () => {
  it('recognises the server frames', () => {
    expect(parseFrame('{"action":"auth.success","success":true}')).toEqual({ kind: 'authOk' });
    expect(parseFrame('{"error":"invalid_token"}')).toEqual({ kind: 'authRejected' });
    expect(parseFrame('{"error":"auth_required"}')).toEqual({ kind: 'error', error: 'auth_required' });
    expect(parseFrame('{"action":"unsubscribed","reason":"x"}')).toEqual({ kind: 'ignored' });
  });
  it('extracts a pushed notification', () => {
    const f = parseFrame(
      JSON.stringify({
        event: 'notification.created',
        data: { id: 9, name: 'task.comment', notification: { task: { id: 4 } } },
      }),
    );
    expect(f).toEqual({
      kind: 'notification',
      notification: { id: 9, name: 'task.comment', payload: { task: { id: 4 } } },
    });
  });
  it('ignores other events and garbage', () => {
    expect(parseFrame('{"event":"timer.created","data":{"id":1}}')).toEqual({ kind: 'ignored' });
    expect(parseFrame('not json')).toEqual({ kind: 'ignored' });
    expect(parseFrame('42')).toEqual({ kind: 'ignored' });
    expect(parseFrame('null')).toEqual({ kind: 'ignored' });
  });
  it('builds the client frames', () => {
    expect(JSON.parse(authFrame('T'))).toEqual({ action: 'auth', token: 'T' });
    expect(JSON.parse(subscribeFrame('notification.created'))).toEqual({
      action: 'subscribe',
      event: 'notification.created',
    });
  });
});

describe('planFor', () => {
  const n = (name: string, payload: unknown = null) => ({ id: 1, name, payload });
  it('targets the task for comments, mentions and assignments', () => {
    for (const name of ['task.comment', 'task.mentioned', 'task.assigned']) {
      expect(planFor(n(name, { task: { id: 42 } }))).toEqual({ taskIds: [42], cycle: false, reconcile: false });
    }
  });
  it('falls back to a cycle when the task id is missing', () => {
    expect(planFor(n('task.comment', { task: {} }))).toEqual({ taskIds: [], cycle: true, reconcile: false });
    expect(planFor(n('task.comment'))).toEqual({ taskIds: [], cycle: true, reconcile: false });
  });
  it('sweeps for deletions on task.deleted', () => {
    expect(planFor(n('task.deleted', { task: { id: 3 } }))).toEqual({ taskIds: [], cycle: false, reconcile: true });
  });
  it('pulls nothing for reminders, overdue and exports', () => {
    for (const name of ['task.reminder', 'task.undone.overdue', 'data.export.ready']) {
      expect(planFor(n(name))).toEqual({ taskIds: [], cycle: false, reconcile: false });
    }
  });
  it('runs a normal cycle for created things and anything unknown', () => {
    for (const name of ['task.created', 'project.created', 'team.member.added', 'something.new']) {
      expect(planFor(n(name))).toEqual({ taskIds: [], cycle: true, reconcile: false });
    }
  });
  it('merges plans without duplicating task ids', () => {
    const a: LivePlan = { taskIds: [1, 2], cycle: false, reconcile: false };
    const b: LivePlan = { taskIds: [2, 3], cycle: true, reconcile: false };
    expect(mergePlans(a, b)).toEqual({ taskIds: [1, 2, 3], cycle: true, reconcile: false });
  });
});

describe('backoffDelay', () => {
  it('doubles from 2s and caps at 60s', () => {
    const d = (n: number) => backoffDelay(n, () => 0.5);
    expect([d(1), d(2), d(3), d(4), d(5), d(6)]).toEqual([2000, 4000, 8000, 16000, 32000, 60000]);
  });
  it('probes far less often after a long streak of failures', () => {
    const d = (n: number) => backoffDelay(n, () => 0.5);
    expect([d(7), d(8), d(9), d(10), d(30)]).toEqual([128_000, 256_000, 512_000, 600_000, 600_000]);
  });
  it('jitters by 25% either way', () => {
    expect(backoffDelay(3, () => 0)).toBe(6000);
    expect(backoffDelay(3, () => 1)).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

describe('handshake', () => {
  it('opens the url, authenticates first, subscribes after auth, then reports live', async () => {
    const h = harness();
    h.client.start();
    expect(h.client.status()).toBe('connecting');
    await settle();
    expect(h.transport.last.url).toBe('wss://vk.test/api/v1/ws');
    expect(h.transport.last.socket.sent).toEqual([authFrame(FRESH_TOKEN)]);
    expect(h.client.status()).toBe('connecting');
    expect(h.onResync).not.toHaveBeenCalled();

    h.transport.last.emit(AUTH_OK);
    await settle();
    expect(h.transport.last.socket.sent).toEqual([
      authFrame(FRESH_TOKEN),
      subscribeFrame('notification.created'),
    ]);
    expect(h.client.status()).toBe('live');
    expect(h.onResync).toHaveBeenCalledTimes(1);
  });

  it('does not resync again on a re-auth acknowledgement', async () => {
    const h = harness();
    const conn = await goLive(h);
    conn.emit(AUTH_OK);
    await settle();
    expect(h.onResync).toHaveBeenCalledTimes(1);
    expect(h.client.status()).toBe('live');
  });

  it('delivers notifications only once authenticated', async () => {
    const h = harness();
    h.client.start();
    await settle();
    h.transport.last.emit(note('task.comment', { task: { id: 1 } }));
    expect(h.onNotification).not.toHaveBeenCalled();

    h.transport.last.emit(AUTH_OK);
    h.transport.last.emit(note('task.comment', { task: { id: 5 } }, 11));
    expect(h.onNotification).toHaveBeenCalledWith({
      id: 11,
      name: 'task.comment',
      payload: { task: { id: 5 } },
    });
  });

  it('survives a throwing callback', async () => {
    const h = harness({
      onNotification: () => {
        throw new Error('boom');
      },
    });
    const conn = await goLive(h);
    conn.emit(note('task.comment', { task: { id: 1 } }));
    expect(h.client.status()).toBe('live');
  });

  it('stays off when there is no server url', async () => {
    const h = harness({ url: () => null });
    h.client.start();
    await settle();
    expect(h.transport.attempts).toBe(0);
    expect(h.client.status()).toBe('off');
  });
});

describe('reconnecting with backoff', () => {
  it('retries a failing connect at 2s, 4s, 8s', async () => {
    const h = harness();
    h.transport.failures = [new Error('refused'), new Error('refused'), new Error('refused')];
    h.client.start();
    await settle();
    expect(h.transport.attempts).toBe(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(h.transport.attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.transport.attempts).toBe(2);

    await vi.advanceTimersByTimeAsync(3999);
    expect(h.transport.attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.transport.attempts).toBe(3);

    await vi.advanceTimersByTimeAsync(7999);
    expect(h.transport.attempts).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.transport.attempts).toBe(4); // the fourth succeeds in opening
    h.transport.last.emit(AUTH_OK);
    await settle();
    expect(h.client.status()).toBe('live');
  });

  it('keeps growing the delay while links die young, and resets after a healthy one', async () => {
    const h = harness();
    // first link dies after 1s: streak 1 -> retry in 2s
    let conn = await goLive(h);
    await vi.advanceTimersByTimeAsync(1000);
    conn.emit({ type: 'close', code: 1006 });
    expect(h.client.status()).toBe('off');
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.transport.attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.transport.attempts).toBe(2);

    // second dies young too: streak 2 -> retry in 4s
    conn = h.transport.last;
    conn.emit(AUTH_OK);
    await settle();
    conn.emit({ type: 'close', code: 1006 });
    await vi.advanceTimersByTimeAsync(3999);
    expect(h.transport.attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.transport.attempts).toBe(3);

    // third stays up 31s: healthy, streak resets -> next retry in 2s, not 8s
    conn = h.transport.last;
    conn.emit(AUTH_OK);
    await settle();
    await vi.advanceTimersByTimeAsync(31_000 - 0);
    conn.emit({ type: 'close', code: 1006 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.transport.attempts).toBe(4);
  });

  it('resyncs after each reconnect, since events may have been missed', async () => {
    const h = harness();
    let conn = await goLive(h);
    conn.emit({ type: 'close', code: 1006 });
    await vi.advanceTimersByTimeAsync(2000);
    conn = h.transport.last;
    conn.emit(AUTH_OK);
    await settle();
    expect(h.onResync).toHaveBeenCalledTimes(2);
  });

  it('treats a stream error as a lost link', async () => {
    const h = harness();
    const conn = await goLive(h);
    conn.emit({ type: 'error', message: 'IO error: connection reset' });
    expect(h.client.status()).toBe('off');
    expect(conn.socket.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.transport.attempts).toBe(2);
  });

  it('drops a link that goes silent (half-open), and server pings keep it alive', async () => {
    const h = harness();
    const conn = await goLive(h);
    // a ping every 30s for 5 minutes: still live
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      conn.emit({ type: 'activity' });
    }
    expect(h.client.status()).toBe('live');
    // then silence
    await vi.advanceTimersByTimeAsync(100_000);
    expect(h.client.status()).toBe('off');
    expect(conn.socket.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.transport.attempts).toBe(2);
  });

  it('gives up on a handshake that never gets an auth reply', async () => {
    const h = harness();
    h.client.start();
    await settle();
    const conn = h.transport.last;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(conn.socket.closed).toBe(true);
    expect(h.client.status()).toBe('off');
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.transport.attempts).toBe(2);
  });

  it('reconnects at once, without a resync, when the server closes for token expiry', async () => {
    const soon = jwt(NOW + 60_000);
    const renewed = jwt(NOW + 11 * 60_000);
    const h = harness();
    h.token.value = soon;
    h.refresh.mockResolvedValue(renewed);
    const conn = await goLive(h);
    expect(h.refresh).not.toHaveBeenCalled(); // 60s left is outside the 30s margin
    expect(h.onResync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(40_000); // inside the margin now
    conn.emit({ type: 'close', code: 1008, reason: 'token expired' });
    await settle();
    expect(h.transport.attempts).toBe(2);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.transport.last.socket.sent[0]).toBe(authFrame(renewed));
    h.transport.last.emit(AUTH_OK);
    await settle();
    expect(h.client.status()).toBe('live');
    expect(h.onResync).toHaveBeenCalledTimes(1);
  });
});

describe('falling back to polling', () => {
  it('stops for good on invalid_token, and retries only when the token changes', async () => {
    const h = harness();
    h.client.start();
    await settle();
    const conn = h.transport.last;
    conn.emit(json({ error: 'invalid_token' }));
    expect(h.client.status()).toBe('off');
    expect(conn.socket.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(h.transport.attempts).toBe(1);

    h.token.value = jwt(Date.now() + 20 * 60_000);
    h.client.tokenChanged();
    await settle();
    expect(h.transport.attempts).toBe(2);
  });

  it('switches off for the session when the route does not exist', async () => {
    const h = harness();
    h.transport.failures = [new Error('HTTP error: 404 Not Found')];
    h.client.start();
    await settle();
    expect(h.client.status()).toBe('off');
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(h.transport.attempts).toBe(1);
  });

  it('also treats 405 as unsupported, but retries other upgrade failures', async () => {
    const a = harness();
    a.transport.failures = [new Error('HTTP error: 405 Method Not Allowed')];
    a.client.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(a.transport.attempts).toBe(1);

    const b = harness();
    b.transport.failures = [new Error('HTTP error: 502 Bad Gateway')];
    b.client.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.transport.attempts).toBe(2);
  });

  it('start() after stop() clears a terminal state', async () => {
    const h = harness();
    h.transport.failures = [new Error('HTTP error: 404 Not Found')];
    h.client.start();
    await settle();
    h.client.stop();
    h.client.start();
    await settle();
    expect(h.transport.attempts).toBe(2);
  });

  it('stop() closes the socket and cancels every pending retry', async () => {
    const h = harness();
    const conn = await goLive(h);
    h.client.stop();
    expect(conn.socket.closed).toBe(true);
    expect(h.client.status()).toBe('off');

    const g = harness();
    g.transport.failures = [new Error('refused')];
    g.client.start();
    await settle();
    g.client.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(g.transport.attempts).toBe(1);
  });

  it('ignores events from a socket it already abandoned', async () => {
    const h = harness();
    const conn = await goLive(h);
    h.client.stop();
    conn.emit(note('task.comment', { task: { id: 1 } }));
    conn.emit({ type: 'close', code: 1006 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.onNotification).not.toHaveBeenCalled();
    expect(h.transport.attempts).toBe(1);
  });
});

describe('tokens', () => {
  it('refreshes a token that is about to expire before sending it', async () => {
    const stale = jwt(NOW + 10_000);
    const renewed = jwt(NOW + 10 * 60_000);
    const h = harness();
    h.token.value = stale;
    h.refresh.mockResolvedValue(renewed);
    h.client.start();
    await settle();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.transport.last.socket.sent).toEqual([authFrame(renewed)]);
  });

  it('does not connect with an expired token it cannot renew, and retries later', async () => {
    const h = harness();
    h.token.value = jwt(NOW - 1000);
    h.client.start();
    await settle();
    expect(h.transport.attempts).toBe(0);
    expect(h.client.status()).toBe('off');
    h.token.value = FRESH_TOKEN;
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.transport.attempts).toBe(1);
  });

  it('still uses a near-expiry token if the refresh fails but it has not expired', async () => {
    const h = harness();
    const nearly = jwt(NOW + 10_000);
    h.token.value = nearly;
    h.client.start();
    await settle();
    expect(h.transport.last.socket.sent).toEqual([authFrame(nearly)]);
  });

  it('re-authenticates an open socket when the token changes, and shrugs off the old-server reply', async () => {
    const h = harness();
    const conn = await goLive(h);
    const next = jwt(NOW + 20 * 60_000);
    h.token.value = next;
    h.client.tokenChanged();
    await settle();
    expect(conn.socket.sent.at(-1)).toBe(authFrame(next));
    conn.emit(json({ error: 'already_authenticated' }));
    expect(h.client.status()).toBe('live');
  });

  it('does not connect without a token', async () => {
    const h = harness();
    h.token.value = null;
    h.client.start();
    await settle();
    expect(h.transport.attempts).toBe(0);
  });
});

describe('page visibility', () => {
  it('on mobile, does not connect while hidden, connects when shown', async () => {
    const h = harness({ pauseWhenHidden: true });
    h.visible.value = false;
    h.client.start();
    await settle();
    expect(h.transport.attempts).toBe(0);

    h.visible.value = true;
    h.client.visibilityChanged();
    await settle();
    expect(h.transport.attempts).toBe(1);
  });

  it('on mobile, closes when hidden and stays quiet until shown again', async () => {
    const h = harness({ pauseWhenHidden: true });
    const conn = await goLive(h);

    h.visible.value = false;
    h.client.visibilityChanged();
    expect(conn.socket.closed).toBe(true);
    expect(h.client.status()).toBe('off');
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(h.transport.attempts).toBe(1);

    h.visible.value = true;
    h.client.visibilityChanged();
    await settle();
    expect(h.transport.attempts).toBe(2);
    h.transport.last.emit(AUTH_OK);
    await settle();
    expect(h.onResync).toHaveBeenCalledTimes(2); // events missed while away
  });

  it('on mobile, a retry timer that falls due while hidden does not connect', async () => {
    const h = harness({ pauseWhenHidden: true });
    h.transport.failures = [new Error('refused')];
    h.client.start();
    await settle();
    h.visible.value = false; // hidden, but visibilityChanged() not delivered yet
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.transport.attempts).toBe(1);
  });

  it('on desktop, hiding the window (tray) keeps the socket', async () => {
    const h = harness({ pauseWhenHidden: false });
    const conn = await goLive(h);
    h.visible.value = false;
    h.client.visibilityChanged();
    expect(conn.socket.closed).toBe(false);
    expect(h.client.status()).toBe('live');
  });

  it('showing the page while already connected does nothing', async () => {
    const h = harness({ pauseWhenHidden: true });
    await goLive(h);
    h.client.visibilityChanged();
    await settle();
    expect(h.transport.attempts).toBe(1);
  });
});

describe('single instance', () => {
  it('starting a second instance stops the first', async () => {
    const t1 = new FakeTransport();
    const t2 = new FakeTransport();
    const base = harness().deps;
    startLiveSync({ ...base, transport: t1 });
    await settle();
    t1.last.emit(AUTH_OK);
    await settle();
    expect(getLiveSyncStatus()).toBe('live');

    startLiveSync({ ...base, transport: t2 });
    await settle();
    expect(t1.last.socket.closed).toBe(true);
    expect(t2.attempts).toBe(1);
    expect(getLiveSyncStatus()).toBe('connecting');

    stopLiveSync();
    expect(t2.last.socket.closed).toBe(true);
    expect(getLiveSyncStatus()).toBe('off');
    expect(globalThis.__cria_liveSync__).toBeUndefined();
  });

  it('keeps its handle on globalThis so a module reload cannot orphan the socket', async () => {
    const base = harness().deps;
    startLiveSync(base);
    expect(globalThis.__cria_liveSync__).toBeDefined();
    stopLiveSync();
    expect(globalThis.__cria_liveSync__).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Events -> pulls
// ---------------------------------------------------------------------------

function actions(): LiveActions & {
  refreshTask: ReturnType<typeof vi.fn>;
  runCycle: ReturnType<typeof vi.fn>;
  reconcile: ReturnType<typeof vi.fn>;
} {
  return {
    refreshTask: vi.fn(async () => {}),
    runCycle: vi.fn(async () => {}),
    reconcile: vi.fn(async () => {}),
  };
}

describe('executePlan', () => {
  it('refetches targeted tasks, then runs the cycle and sweep if asked', async () => {
    const a = actions();
    await executePlan({ taskIds: [3, 4], cycle: true, reconcile: true }, a);
    expect(a.refreshTask.mock.calls).toEqual([[3], [4]]);
    expect(a.runCycle).toHaveBeenCalledTimes(1);
    expect(a.reconcile).toHaveBeenCalledTimes(1);
  });

  it('collapses a large batch of targeted refetches into one cycle', async () => {
    const a = actions();
    await executePlan({ taskIds: [1, 2, 3, 4, 5, 6], cycle: false, reconcile: false }, a);
    expect(a.refreshTask).not.toHaveBeenCalled();
    expect(a.runCycle).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one step fails', async () => {
    const a = actions();
    a.refreshTask.mockRejectedValueOnce(new Error('500'));
    await executePlan({ taskIds: [1, 2], cycle: true, reconcile: true }, a);
    expect(a.refreshTask).toHaveBeenCalledTimes(2);
    expect(a.runCycle).toHaveBeenCalledTimes(1);
    expect(a.reconcile).toHaveBeenCalledTimes(1);
  });
});

describe('createPlanRunner', () => {
  it('coalesces a burst into one run', async () => {
    const run = vi.fn(async (_p: LivePlan) => {});
    const runner = createPlanRunner(run, 500);
    runner.add({ taskIds: [1], cycle: false, reconcile: false });
    await vi.advanceTimersByTimeAsync(300);
    runner.add({ taskIds: [2, 1], cycle: false, reconcile: false });
    await vi.advanceTimersByTimeAsync(499);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toEqual({ taskIds: [1, 2], cycle: false, reconcile: false });
  });

  it('runs again after an in-flight run if more arrived meanwhile', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = vi.fn(async (p: LivePlan) => {
      if (run.mock.calls.length === 1) await gate;
      return void p;
    });
    const runner = createPlanRunner(run, 100);
    runner.add({ taskIds: [], cycle: true, reconcile: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);

    runner.add({ taskIds: [9], cycle: false, reconcile: false }); // during the run
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1); // not concurrently

    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0]).toEqual({ taskIds: [9], cycle: false, reconcile: false });
  });

  it('drops pending work on cancel, and ignores empty plans', async () => {
    const run = vi.fn(async (_p: LivePlan) => {});
    const runner = createPlanRunner(run, 100);
    runner.add({ taskIds: [], cycle: false, reconcile: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();

    runner.add({ taskIds: [], cycle: true, reconcile: false });
    runner.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
    runner.add({ taskIds: [], cycle: true, reconcile: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('createLiveHandlers', () => {
  function setup(recentlySynced = false) {
    const a = actions();
    const refreshNotifications = vi.fn();
    const handlers = createLiveHandlers({
      actions: a,
      refreshNotifications,
      recentlySynced: () => recentlySynced,
      delayMs: 500,
    });
    return { a, refreshNotifications, handlers };
  }

  it('a comment notification refreshes the bell and refetches that task', async () => {
    const { a, refreshNotifications, handlers } = setup();
    handlers.onNotification({ id: 1, name: 'task.comment', payload: { task: { id: 42 } } });
    expect(refreshNotifications).toHaveBeenCalledTimes(1);
    expect(a.refreshTask).not.toHaveBeenCalled(); // debounced
    await vi.advanceTimersByTimeAsync(500);
    expect(a.refreshTask).toHaveBeenCalledWith(42);
    expect(a.runCycle).not.toHaveBeenCalled();
  });

  it('a task.deleted notification sweeps for deletions', async () => {
    const { a, handlers } = setup();
    handlers.onNotification({ id: 1, name: 'task.deleted', payload: { task: { id: 42 } } });
    await vi.advanceTimersByTimeAsync(500);
    expect(a.reconcile).toHaveBeenCalledTimes(1);
    expect(a.refreshTask).not.toHaveBeenCalled();
  });

  it('a reminder only refreshes the bell', async () => {
    const { a, refreshNotifications, handlers } = setup();
    handlers.onNotification({ id: 1, name: 'task.reminder', payload: { task: { id: 42 } } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(refreshNotifications).toHaveBeenCalledTimes(1);
    expect(a.refreshTask).not.toHaveBeenCalled();
    expect(a.runCycle).not.toHaveBeenCalled();
  });

  it('a burst of different events makes one batch of pulls', async () => {
    const { a, handlers } = setup();
    handlers.onNotification({ id: 1, name: 'task.comment', payload: { task: { id: 1 } } });
    handlers.onNotification({ id: 2, name: 'task.assigned', payload: { task: { id: 2 } } });
    handlers.onNotification({ id: 3, name: 'project.created', payload: {} });
    await vi.advanceTimersByTimeAsync(500);
    expect(a.refreshTask.mock.calls).toEqual([[1], [2]]);
    expect(a.runCycle).toHaveBeenCalledTimes(1);
  });

  it('a resync runs a catch-up cycle unless one just ran', async () => {
    const quiet = setup(false);
    quiet.handlers.onResync();
    expect(quiet.refreshNotifications).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(quiet.a.runCycle).toHaveBeenCalledTimes(1);

    const busy = setup(true);
    busy.handlers.onResync();
    await vi.advanceTimersByTimeAsync(500);
    expect(busy.refreshNotifications).toHaveBeenCalledTimes(1);
    expect(busy.a.runCycle).not.toHaveBeenCalled();
  });

  it('cancel drops queued pulls', async () => {
    const { a, handlers } = setup();
    handlers.onNotification({ id: 1, name: 'task.created', payload: {} });
    handlers.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(a.runCycle).not.toHaveBeenCalled();
  });
});

describe('end to end with a fake transport', () => {
  it('a pushed comment notification triggers a targeted pull and nothing else', async () => {
    const a = actions();
    const refreshNotifications = vi.fn();
    const handlers = createLiveHandlers({
      actions: a,
      refreshNotifications,
      recentlySynced: () => true,
      delayMs: 500,
    });
    const h = harness({ onNotification: handlers.onNotification, onResync: handlers.onResync });
    const conn = await goLive(h);

    conn.emit(note('task.comment', { task: { id: 77 } }));
    await vi.advanceTimersByTimeAsync(500);

    expect(refreshNotifications).toHaveBeenCalledTimes(2); // once for connect, once for the event
    expect(a.refreshTask.mock.calls).toEqual([[77]]);
    expect(a.runCycle).not.toHaveBeenCalled();
    expect(a.reconcile).not.toHaveBeenCalled();
  });

  it('never calls notify() on the live path', async () => {
    const a = actions();
    const handlers = createLiveHandlers({
      actions: a,
      refreshNotifications: () => {},
      recentlySynced: () => false,
      delayMs: 100,
    });
    const h = harness({ onNotification: handlers.onNotification, onResync: handlers.onResync });
    const conn = await goLive(h);
    conn.emit(note('task.created', {}));
    conn.emit(note('task.deleted', { task: { id: 1 } }));
    conn.emit(note('task.comment', { task: { id: 2 } }));
    conn.emit({ type: 'close', code: 1006 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(a.runCycle).toHaveBeenCalled();
    expect(bus.notify).not.toHaveBeenCalled();
  });

  it('the module does not import the db layer or call notify() itself', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/sync/liveSync.ts', import.meta.url)), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/from\s+['"]@\/db/);
    expect(code).not.toMatch(/\bnotify\s*\(/);
  });
});
