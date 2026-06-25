/**
 * Credential storage.
 *
 * The **whole** credential (serverUrl, token, authMethod) is kept in the OS
 * secret store — macOS/iOS Keychain, Windows Credential Manager, Linux Secret
 * Service — via the `secure_*_token` commands, stored as one JSON blob. Keeping
 * everything there (not just the token) means a relaunch can restore the session
 * from the Keychain alone: iOS may evict WKWebView localStorage between launches,
 * and when only the non-secret meta lived there, losing it logged the user out
 * even though the token was safe in the Keychain ("logged out after reopening
 * the app"). The serverUrl/authMethod aren't secrets, so co-locating them with
 * the token is no security downgrade — the token is still the only thing an
 * attacker couldn't otherwise obtain, and it never touches localStorage when a
 * keychain is available.
 *
 * Where the native commands aren't present or the store errors — the
 * browser-only dev server, tests, Android — credentials fall back to
 * localStorage (token in `cria:token/v1`, meta in `cria:credentials/v2`). We
 * probe the secure store once and cache the result.
 *
 * Migration: the old single blob (`cria:credentials/v1`) and the previous split
 * layout (bare token in the keychain + meta in localStorage) are both upgraded
 * to the full-creds keychain blob on first load.
 *
 * All entry points are async because the keychain round-trips over IPC. The
 * running token is held in memory by the auth store for synchronous reads (see
 * getAuthSnapshot); this layer is only the at-rest persistence.
 */

const LEGACY_KEY = 'cria:credentials/v1';
const META_KEY = 'cria:credentials/v2';
const TOKEN_FALLBACK_KEY = 'cria:token/v1';

export interface Credentials {
  serverUrl: string;
  token: string;
  authMethod: 'token' | 'password';
}

const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let secureAvailable: boolean | null = null;

async function invokeCmd<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Whether the OS-keychain commands exist + work. Probed once. */
async function useSecureStore(): Promise<boolean> {
  if (secureAvailable !== null) return secureAvailable;
  if (!isTauri) {
    secureAvailable = false;
    return false;
  }
  try {
    await invokeCmd<string | null>('secure_get_token');
    secureAvailable = true;
  } catch {
    // Command absent or store unreachable → use localStorage.
    secureAvailable = false;
  }
  return secureAvailable;
}

/* ── Raw accessors for the single keychain slot ─────────────────────────── */

async function readSecureRaw(): Promise<string | null> {
  return (await invokeCmd<string | null>('secure_get_token')) ?? null;
}

async function writeSecureRaw(value: string): Promise<void> {
  await invokeCmd('secure_set_token', { token: value });
}

async function clearSecureRaw(): Promise<void> {
  try {
    await invokeCmd('secure_delete_token');
  } catch {
    /* already gone / store error — non-fatal on sign-out */
  }
}

/** Parse a keychain slot value as a full-credentials blob, or null if it's a
 *  bare legacy token / unparseable. */
function parseCreds(raw: string | null): Credentials | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<Credentials>;
    if (o && typeof o.serverUrl === 'string' && typeof o.token === 'string') {
      return {
        serverUrl: o.serverUrl,
        token: o.token,
        authMethod: o.authMethod === 'password' ? 'password' : 'token',
      };
    }
  } catch {
    /* not JSON → a legacy bare token */
  }
  return null;
}

/* ── localStorage meta (fallback platforms + non-secret cache) ──────────── */

interface Meta {
  serverUrl: string;
  authMethod: 'token' | 'password';
}

function readMeta(): Meta | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(META_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Meta>;
    if (typeof parsed.serverUrl !== 'string') return null;
    return {
      serverUrl: parsed.serverUrl,
      authMethod: parsed.authMethod === 'password' ? 'password' : 'token',
    };
  } catch {
    return null;
  }
}

function writeMeta(meta: Meta): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

/** One-shot migration from the old single-blob `cria:credentials/v1`. */
async function migrateLegacy(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<Credentials>;
    if (typeof parsed.serverUrl === 'string' && typeof parsed.token === 'string') {
      await saveCredentials({
        serverUrl: parsed.serverUrl,
        token: parsed.token,
        authMethod: parsed.authMethod === 'password' ? 'password' : 'token',
      });
    }
  } catch {
    /* corrupt legacy blob — just drop it */
  }
  // Scrub the plaintext token from the old location no matter what.
  localStorage.removeItem(LEGACY_KEY);
}

export async function loadCredentials(): Promise<Credentials | null> {
  await migrateLegacy();

  if (await useSecureStore()) {
    const raw = await readSecureRaw();
    const creds = parseCreds(raw);
    if (creds) return creds;
    // Legacy split layout: the keychain held only a bare token. Combine with
    // localStorage meta and upgrade the slot to the full-creds blob so the next
    // launch no longer needs localStorage.
    if (raw) {
      const meta = readMeta();
      if (meta) {
        const upgraded: Credentials = {
          serverUrl: meta.serverUrl,
          token: raw,
          authMethod: meta.authMethod,
        };
        void writeSecureRaw(JSON.stringify(upgraded)).catch(() => {});
        return upgraded;
      }
    }
    return null;
  }

  // Non-secure platforms (Android, browser dev): localStorage only.
  const meta = readMeta();
  if (!meta) return null;
  if (typeof localStorage === 'undefined') return null;
  const token = localStorage.getItem(TOKEN_FALLBACK_KEY);
  if (!token) return null;
  return { serverUrl: meta.serverUrl, token, authMethod: meta.authMethod };
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  if (await useSecureStore()) {
    // Everything in the keychain. Keep a non-secret meta copy in localStorage
    // (harmless cache), but never the token, and scrub any stale fallback token.
    await writeSecureRaw(JSON.stringify(creds));
    writeMeta({ serverUrl: creds.serverUrl, authMethod: creds.authMethod });
    if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_FALLBACK_KEY);
    return;
  }
  writeMeta({ serverUrl: creds.serverUrl, authMethod: creds.authMethod });
  if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_FALLBACK_KEY, creds.token);
}

export async function clearCredentials(): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(META_KEY);
    localStorage.removeItem(TOKEN_FALLBACK_KEY);
  }
  if (await useSecureStore()) await clearSecureRaw();
}
