/**
 * Live sync: an optional, best-effort client for Vikunja's WebSocket endpoint.
 *
 * What upstream actually offers (go-vikunja/vikunja, pkg/websocket, first
 * shipped in 2.3.0): `GET /api/v1/ws` upgrades without credentials, the first
 * client message must be `{"action":"auth","token":"<user JWT>"}`, then the
 * client subscribes per event with `{"action":"subscribe","event":"..."}`.
 * The only events are `notification.created` and (2.4.0+, pro licence)
 * `timer.created|updated|deleted`. There is NO push for task, project, label
 * or comment changes, and a notification is never sent to the user who caused
 * it. So this is a trigger for *other people's* activity (assignments,
 * comments, mentions, tasks created or deleted in shared projects); edits made
 * from your own other devices still arrive on the 60s poll.
 *
 * Rules this module keeps (see AGENTS.md):
 * - It never touches the DB and never calls `notify()`. An event only asks the
 *   existing pull path (a targeted task refetch, or `runSyncCycle`) to run;
 *   those do their own silent upserts and their own post-pull notify.
 * - The poll keeps running underneath. Nothing here is required for sync.
 * - One instance, pinned on `globalThis` so a Vite HMR reload can't leave a
 *   second socket behind.
 * - Everything environmental (transport, token, visibility, clock) is injected,
 *   so the unit tests drive it with a fake transport and fake timers.
 */

// ---------------------------------------------------------------------------
// Transport seam
// ---------------------------------------------------------------------------

export type TransportEvent =
  | { type: 'text'; data: string }
  /** Any other inbound traffic (server pings/pongs): proof the link is alive. */
  | { type: 'activity' }
  | { type: 'close'; code?: number; reason?: string }
  | { type: 'error'; message: string };

export interface LiveSocket {
  send(text: string): Promise<void>;
  close(): Promise<void>;
}

export interface LiveTransport {
  /** Rejects if the connection can't be opened. Frames arrive via `onEvent`. */
  connect(url: string, onEvent: (event: TransportEvent) => void): Promise<LiveSocket>;
}

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------

/** First release with /ws (pkg/websocket landed in 2.3.0; /info has no flag). */
const MIN_VERSION = { major: 2, minor: 3, patch: 0 };

/**
 * Whether a server's `/info` version can have the endpoint. Only a version
 * known to predate it says no. A missing or unparseable one (a failed probe,
 * dev and nightly builds) says yes: a failed attempt is cheap, backs off, and
 * a 404 on the upgrade switches the client off for the session.
 */
export function supportsLiveSync(version: string | null | undefined): boolean {
  const m = version ? /(\d+)\.(\d+)\.(\d+)/.exec(version) : null;
  if (!m) return true;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (major !== MIN_VERSION.major) return major > MIN_VERSION.major;
  if (minor !== MIN_VERSION.minor) return minor > MIN_VERSION.minor;
  return patch >= MIN_VERSION.patch;
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * `wss://host/api/v1/ws` for an https server, `ws://` for a loopback http one.
 * Anything else returns null: the first frame carries the JWT, so a plaintext
 * socket to a remote host is refused, same rule as the Bearer header.
 */
export function liveUrl(serverUrl: string | null | undefined): string | null {
  if (!serverUrl) return null;
  let u: URL;
  try {
    u = new URL(serverUrl.replace(/\/+$/, ''));
  } catch {
    return null;
  }
  if (u.protocol === 'https:') u.protocol = 'wss:';
  else if (u.protocol === 'http:' && LOOPBACK_HOSTS.includes(u.hostname)) u.protocol = 'ws:';
  else return null;
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/api/v1/ws`;
  u.search = '';
  u.hash = '';
  return u.href;
}

/** True for a three-part dotted token. API tokens (`tk_...`) are not JWTs and /ws rejects them. */
export function looksLikeJwt(token: string | null | undefined): boolean {
  return !!token && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
}

/** The JWT's `exp` claim in ms since epoch, or null if it isn't a readable JWT. */
export function jwtExpiresAt(token: string): number | null {
  if (!looksLikeJwt(token)) return null;
  try {
    const payload = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export const NOTIFICATION_EVENT = 'notification.created';

export function authFrame(token: string): string {
  return JSON.stringify({ action: 'auth', token });
}

export function subscribeFrame(event: string): string {
  return JSON.stringify({ action: 'subscribe', event });
}

/** A pushed notification, as stored by the server (`GET /notifications` row shape). */
export interface LiveNotification {
  id: number;
  /** `task.comment`, `task.assigned`, `project.created`, ... */
  name: string;
  payload: unknown;
}

export type Frame =
  | { kind: 'authOk' }
  /** `invalid_token`: retrying with the same token can't help. */
  | { kind: 'authRejected' }
  | { kind: 'error'; error: string }
  | { kind: 'notification'; notification: LiveNotification }
  | { kind: 'ignored' };

export function parseFrame(text: string): Frame {
  let msg: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return { kind: 'ignored' };
    msg = parsed as Record<string, unknown>;
  } catch {
    return { kind: 'ignored' };
  }
  if (msg.action === 'auth.success' && msg.success === true) return { kind: 'authOk' };
  if (msg.error === 'invalid_token') return { kind: 'authRejected' };
  if (typeof msg.error === 'string') return { kind: 'error', error: msg.error };
  if (msg.event === NOTIFICATION_EVENT && msg.data && typeof msg.data === 'object') {
    const d = msg.data as Record<string, unknown>;
    return {
      kind: 'notification',
      notification: {
        id: typeof d.id === 'number' ? d.id : 0,
        name: typeof d.name === 'string' ? d.name : '',
        payload: d.notification ?? null,
      },
    };
  }
  return { kind: 'ignored' };
}

// ---------------------------------------------------------------------------
// Event -> pull plan
// ---------------------------------------------------------------------------

/** What an event should make the existing pull path do. */
export interface LivePlan {
  /** Server ids of tasks to refetch with comments (targeted pull). */
  taskIds: number[];
  /** Run a normal sync cycle. */
  cycle: boolean;
  /** Sweep for tasks deleted elsewhere (the delta pull can't see deletions). */
  reconcile: boolean;
}

const EMPTY_PLAN: LivePlan = { taskIds: [], cycle: false, reconcile: false };

function taskIdOf(payload: unknown): number | null {
  const task = (payload as { task?: { id?: unknown } } | null)?.task;
  return typeof task?.id === 'number' && task.id > 0 ? task.id : null;
}

export function planFor(n: LiveNotification): LivePlan {
  switch (n.name) {
    case 'task.comment':
    case 'task.mentioned':
    case 'task.assigned': {
      const id = taskIdOf(n.payload);
      // No usable id: fall back to a normal cycle rather than dropping it.
      return id === null ? { ...EMPTY_PLAN, cycle: true } : { ...EMPTY_PLAN, taskIds: [id] };
    }
    case 'task.deleted':
      return { ...EMPTY_PLAN, reconcile: true };
    // Reminders are scheduled locally, overdue and export-ready change no
    // synced row: the bell refresh is all they need.
    case 'task.reminder':
    case 'task.undone.overdue':
    case 'data.export.ready':
      return EMPTY_PLAN;
    // task.created, project.created, team.member.added and anything a newer
    // server adds: a normal cycle is the safe superset.
    default:
      return { ...EMPTY_PLAN, cycle: true };
  }
}

export function mergePlans(a: LivePlan, b: LivePlan): LivePlan {
  return {
    taskIds: [...new Set([...a.taskIds, ...b.taskIds])],
    cycle: a.cycle || b.cycle,
    reconcile: a.reconcile || b.reconcile,
  };
}

export function isEmptyPlan(p: LivePlan): boolean {
  return p.taskIds.length === 0 && !p.cycle && !p.reconcile;
}

/** More than this many targeted refetches is cheaper as one cycle. */
const MAX_TARGETED_TASKS = 5;

export interface LiveActions {
  refreshTask(serverId: number): Promise<void>;
  runCycle(): Promise<void>;
  reconcile(): Promise<void>;
}

/**
 * Carry a plan out through the existing pull functions. Each step is isolated:
 * one failing request must not stop the rest. Note what is NOT here: no DB
 * write and no notify(). The actions own both.
 */
export async function executePlan(plan: LivePlan, actions: LiveActions): Promise<void> {
  const tooMany = plan.taskIds.length > MAX_TARGETED_TASKS;
  const cycle = plan.cycle || tooMany;
  const guard = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.warn(`[live-sync] ${label} failed:`, err);
    }
  };
  if (!tooMany) {
    for (const id of plan.taskIds) await guard(`refetch task ${id}`, () => actions.refreshTask(id));
  }
  if (cycle) await guard('sync cycle', () => actions.runCycle());
  if (plan.reconcile) await guard('deletion sweep', () => actions.reconcile());
}

export interface PlanRunner {
  add(plan: LivePlan): void;
  cancel(): void;
}

/**
 * Coalesce a burst of events into one run: wait `delayMs` after the latest
 * event, run the merged plan, and if more arrived meanwhile run once more
 * after it finishes (an in-flight pull may already have passed the stage the
 * new event needs).
 */
export function createPlanRunner(
  run: (plan: LivePlan) => Promise<void>,
  delayMs = 500,
): PlanRunner {
  let pending: LivePlan = EMPTY_PLAN;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let cancelled = false;

  const flush = async () => {
    timer = null;
    if (cancelled || running || isEmptyPlan(pending)) return;
    const plan = pending;
    pending = EMPTY_PLAN;
    running = true;
    try {
      await run(plan);
    } catch (err) {
      console.warn('[live-sync] run failed:', err);
    } finally {
      running = false;
    }
    if (!cancelled && !isEmptyPlan(pending)) schedule();
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), delayMs);
  };

  return {
    add(plan) {
      if (cancelled || isEmptyPlan(plan)) return;
      pending = mergePlans(pending, plan);
      if (!running) schedule();
    },
    cancel() {
      cancelled = true;
      pending = EMPTY_PLAN;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export interface LiveHandlerDeps {
  actions: LiveActions;
  /** The in-app notification list is stale: refetch it. */
  refreshNotifications: () => void;
  /** A sync cycle is running or just finished, so a catch-up would repeat it. */
  recentlySynced: () => boolean;
  /** Debounce for bursts; defaults to 500ms. */
  delayMs?: number;
}

export interface LiveHandlers {
  onNotification: (n: LiveNotification) => void;
  onResync: () => void;
  cancel: () => void;
}

/** The glue between the client's callbacks and the pull path. */
export function createLiveHandlers(deps: LiveHandlerDeps): LiveHandlers {
  const runner = createPlanRunner((plan) => executePlan(plan, deps.actions), deps.delayMs);
  return {
    onNotification(n) {
      deps.refreshNotifications();
      runner.add(planFor(n));
    },
    onResync() {
      // Notifications pushed while the link was down were never seen.
      deps.refreshNotifications();
      if (!deps.recentlySynced()) runner.add({ ...EMPTY_PLAN, cycle: true });
    },
    cancel: () => runner.cancel(),
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** `connecting` covers the open + auth handshake; `off` is everything else. */
export type LiveStatus = 'off' | 'connecting' | 'live';

export interface LiveClientDeps {
  transport: LiveTransport;
  /** The ws(s) URL for the current server, or null for none. */
  url: () => string | null;
  /** The current JWT. */
  token: () => string | null;
  /** Exchange the refresh token for a new JWT; null if it can't be renewed. */
  refresh: () => Promise<string | null>;
  isVisible: () => boolean;
  /** Mobile: close the socket while the page is hidden (iOS suspends it anyway). */
  pauseWhenHidden: boolean;
  onNotification: (n: LiveNotification) => void;
  /** The link just became live: anything pushed while it was down was missed. */
  onResync: () => void;
  onStatus?: (status: LiveStatus) => void;
  now?: () => number;
  random?: () => number;
}

export interface LiveClient {
  start(): void;
  stop(): void;
  /** The auth store holds a new token. */
  tokenChanged(): void;
  /** The page went to, or came back from, the background. */
  visibilityChanged(): void;
  status(): LiveStatus;
}

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;
/** After this many failures in a row, probe far less often (proxy without WS support, wrong origin). */
const SLOW_AFTER_FAILURES = 6;
const SLOW_MAX_DELAY_MS = 10 * 60_000;
/** A link that stayed up this long counts as healthy: the failure streak resets. */
const HEALTHY_AFTER_MS = 30_000;
const AUTH_TIMEOUT_MS = 15_000;
/** The server pings every 30s; silence for this long means a half-open link. */
const IDLE_TIMEOUT_MS = 100_000;
/** Refresh a JWT that is this close to expiry before putting it on the wire. */
const TOKEN_MARGIN_MS = 30_000;

/** Delay before attempt number `failures + 1`, with +-25% jitter. */
export function backoffDelay(failures: number, random: () => number = Math.random): number {
  const cap = failures > SLOW_AFTER_FAILURES ? SLOW_MAX_DELAY_MS : MAX_DELAY_MS;
  const base = Math.min(cap, BASE_DELAY_MS * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.75 + random() * 0.5));
}

/** The plugin reports a refused upgrade as "HTTP error: 404 Not Found". */
function upgradeStatus(err: unknown): number | null {
  const m = /HTTP error: (\d{3})/.exec(err instanceof Error ? err.message : String(err));
  return m ? Number(m[1]) : null;
}

interface Attempt {
  socket: LiveSocket | null;
  authed: boolean;
  liveSince: number;
  dead: boolean;
  authTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export function createLiveClient(deps: LiveClientDeps): LiveClient {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;

  let wanted = false;
  /** `unsupported`: the route doesn't exist. `rejected`: the server refused the JWT. */
  let terminal: 'unsupported' | 'rejected' | null = null;
  let status: LiveStatus = 'off';
  let current: Attempt | null = null;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** The last close was the server's routine token-expiry close, not a gap. */
  let expectedGap = false;

  const setStatus = (next: LiveStatus) => {
    if (next === status) return;
    status = next;
    console.debug(`[live-sync] ${next}`);
    deps.onStatus?.(next);
  };
  const mayRun = () =>
    wanted && terminal === null && (!deps.pauseWhenHidden || deps.isVisible());
  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const noop = () => {};
  // Callbacks run inside the transport's event handler: one that throws must
  // not take the connection state machine down with it.
  const safely = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      console.warn('[live-sync] handler failed:', err);
    }
  };

  const teardown = (attempt: Attempt) => {
    attempt.dead = true;
    if (attempt.authTimer) clearTimeout(attempt.authTimer);
    if (attempt.idleTimer) clearTimeout(attempt.idleTimer);
    attempt.authTimer = attempt.idleTimer = null;
    if (current === attempt) current = null;
    // Closing a socket that never opened, or one the peer already closed, may
    // reject; there is nothing left to do about it.
    void attempt.socket?.close().catch(noop);
  };

  const armIdle = (attempt: Attempt) => {
    if (attempt.idleTimer) clearTimeout(attempt.idleTimer);
    attempt.idleTimer = setTimeout(() => lost(attempt), IDLE_TIMEOUT_MS);
  };

  const scheduleRetry = (delayMs?: number) => {
    clearRetry();
    if (!mayRun()) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delayMs ?? backoffDelay(failures, random));
  };

  /** The link is gone (or never came up): count it, back off, try again. */
  function lost(attempt: Attempt) {
    if (attempt.dead) return;
    const liveFor = attempt.authed ? now() - attempt.liveSince : 0;
    teardown(attempt);
    setStatus('off');
    expectedGap = false; // a failed reconnect makes the gap real
    failures = liveFor >= HEALTHY_AFTER_MS ? 0 : failures + 1;
    scheduleRetry();
  }

  async function freshToken(): Promise<string | null> {
    const token = deps.token();
    if (!token) return null;
    const exp = jwtExpiresAt(token);
    if (exp !== null && exp - now() < TOKEN_MARGIN_MS) {
      const renewed = await deps.refresh();
      if (renewed) return renewed;
      if (exp <= now()) return null;
    }
    return token;
  }

  async function connect() {
    clearRetry();
    if (!mayRun() || current) return;
    const url = deps.url();
    if (!url) {
      setStatus('off');
      return;
    }
    const attempt: Attempt = {
      socket: null,
      authed: false,
      liveSince: 0,
      dead: false,
      authTimer: null,
      idleTimer: null,
    };
    current = attempt;
    setStatus('connecting');
    try {
      const token = await freshToken();
      if (attempt.dead) return;
      if (!token) throw new Error('no usable token');
      const socket = await deps.transport.connect(url, (e) => onTransportEvent(attempt, e));
      if (attempt.dead) {
        void socket.close().catch(noop);
        return;
      }
      attempt.socket = socket;
      attempt.authTimer = setTimeout(() => lost(attempt), AUTH_TIMEOUT_MS);
      await socket.send(authFrame(token));
    } catch (err) {
      if (attempt.dead) return;
      const httpStatus = upgradeStatus(err);
      if (httpStatus === 404 || httpStatus === 405) {
        // No /ws route here (older server, or a proxy that doesn't forward it).
        terminal = 'unsupported';
        teardown(attempt);
        setStatus('off');
        console.debug('[live-sync] endpoint not available; staying on polling');
        return;
      }
      lost(attempt);
    }
  }

  function onTransportEvent(attempt: Attempt, event: TransportEvent) {
    if (attempt.dead) return;
    switch (event.type) {
      case 'activity':
        if (attempt.authed) armIdle(attempt);
        return;
      case 'error':
        lost(attempt);
        return;
      case 'close':
        if (attempt.authed && event.reason === 'token expired') {
          // The server closes at JWT expiry (2.7+). Not a gap worth a resync:
          // reconnect at once; connect() refreshes the token first.
          expectedGap = true;
          teardown(attempt);
          setStatus('off');
          scheduleRetry(0);
          return;
        }
        lost(attempt);
        return;
      case 'text':
        if (attempt.authed) armIdle(attempt);
        onFrame(attempt, parseFrame(event.data));
        return;
    }
  }

  function onFrame(attempt: Attempt, frame: Frame) {
    switch (frame.kind) {
      case 'authOk': {
        if (attempt.authed) return; // a re-auth ack: subscriptions persist
        attempt.authed = true;
        attempt.liveSince = now();
        if (attempt.authTimer) clearTimeout(attempt.authTimer);
        attempt.authTimer = null;
        armIdle(attempt);
        void attempt.socket
          ?.send(subscribeFrame(NOTIFICATION_EVENT))
          .catch(() => lost(attempt));
        setStatus('live');
        if (!expectedGap) safely(() => deps.onResync());
        expectedGap = false;
        return;
      }
      case 'authRejected':
        // Stop until the token changes: hammering /ws with a bad token is rude.
        terminal = 'rejected';
        teardown(attempt);
        setStatus('off');
        return;
      case 'error':
        if (frame.error === 'auth_required') lost(attempt);
        // `already_authenticated` (older servers answering a re-auth) and
        // `invalid_event` change nothing for us.
        return;
      case 'notification':
        if (attempt.authed) safely(() => deps.onNotification(frame.notification));
        return;
      case 'ignored':
        return;
    }
  }

  return {
    start() {
      wanted = true;
      terminal = null;
      failures = 0;
      void connect();
    },
    stop() {
      wanted = false;
      terminal = null;
      expectedGap = false;
      clearRetry();
      if (current) teardown(current);
      setStatus('off');
    },
    tokenChanged() {
      if (!wanted) return;
      if (terminal === 'rejected') {
        terminal = null;
        failures = 0;
        void connect();
        return;
      }
      const token = deps.token();
      if (current?.authed && token) {
        // 2.7+ extends the session; older servers answer already_authenticated.
        void current.socket?.send(authFrame(token)).catch(noop);
      }
    },
    visibilityChanged() {
      if (!wanted) return;
      if (!mayRun()) {
        clearRetry();
        if (current) teardown(current);
        expectedGap = false;
        setStatus('off');
        return;
      }
      if (!current && !retryTimer) {
        failures = 0;
        void connect();
      }
    },
    status: () => status,
  };
}

// ---------------------------------------------------------------------------
// Single instance, pinned against HMR
// ---------------------------------------------------------------------------

interface LiveHandle {
  client: LiveClient;
  stop(): void;
}

declare global {
  var __cria_liveSync__: LiveHandle | undefined;
}

/**
 * Start the one live client, stopping any previous instance first. The handle
 * lives on globalThis so a Vite HMR reload of this module can't strand an old
 * socket that keeps firing events into a dead closure.
 */
export function startLiveSync(deps: LiveClientDeps): LiveClient {
  globalThis.__cria_liveSync__?.stop();
  const client = createLiveClient(deps);
  const handle: LiveHandle = {
    client,
    stop() {
      client.stop();
      if (globalThis.__cria_liveSync__ === handle) globalThis.__cria_liveSync__ = undefined;
    },
  };
  globalThis.__cria_liveSync__ = handle;
  client.start();
  return client;
}

export function stopLiveSync(): void {
  globalThis.__cria_liveSync__?.stop();
}

/** For diagnostics and tests: `off` when no instance exists. */
export function getLiveSyncStatus(): LiveStatus {
  return globalThis.__cria_liveSync__?.client.status() ?? 'off';
}
