/**
 * Credential storage.
 *
 * The non-secret bits (serverUrl, authMethod) live in localStorage. The **auth
 * token** is kept in the OS secret store — macOS/iOS Keychain, Windows
 * Credential Manager, Linux Secret Service — via the `secure_*_token` Tauri
 * commands, so a stolen app-data-dir snapshot no longer yields a usable token.
 *
 * Where the native commands aren't present or the store errors — the
 * browser-only dev server, tests, Android, or an iOS keychain-access failure —
 * the token falls back to localStorage. We probe once and cache the result.
 * Legacy single-blob credentials (`cria:credentials/v1`) are migrated to this
 * split layout on first load and the plaintext token is scrubbed.
 *
 * All three entry points are async because the keychain round-trips over IPC.
 * The running token is held in memory by the auth store for synchronous reads
 * (see getAuthSnapshot); this layer is only the at-rest persistence.
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

/** Whether the OS-keychain commands exist (desktop builds). Probed once. */
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
    // Command absent (iOS) or store unreachable → use localStorage.
    secureAvailable = false;
  }
  return secureAvailable;
}

async function readToken(): Promise<string | null> {
  if (await useSecureStore()) {
    return (await invokeCmd<string | null>('secure_get_token')) ?? null;
  }
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(TOKEN_FALLBACK_KEY);
}

async function writeToken(token: string): Promise<void> {
  if (await useSecureStore()) {
    await invokeCmd('secure_set_token', { token });
    return;
  }
  if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_FALLBACK_KEY, token);
}

async function removeToken(): Promise<void> {
  if (await useSecureStore()) {
    try {
      await invokeCmd('secure_delete_token');
    } catch {
      /* already gone / store error — non-fatal on sign-out */
    }
  }
  // Always clear any localStorage fallback copy too, regardless of backend.
  if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_FALLBACK_KEY);
}

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
      writeMeta({
        serverUrl: parsed.serverUrl,
        authMethod: parsed.authMethod === 'password' ? 'password' : 'token',
      });
      await writeToken(parsed.token);
    }
  } catch {
    /* corrupt legacy blob — just drop it */
  }
  // Scrub the plaintext token from the old location no matter what.
  localStorage.removeItem(LEGACY_KEY);
}

export async function loadCredentials(): Promise<Credentials | null> {
  await migrateLegacy();
  const meta = readMeta();
  if (!meta) return null;
  const token = await readToken();
  if (!token) return null;
  return { serverUrl: meta.serverUrl, token, authMethod: meta.authMethod };
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  writeMeta({ serverUrl: creds.serverUrl, authMethod: creds.authMethod });
  await writeToken(creds.token);
}

export async function clearCredentials(): Promise<void> {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(META_KEY);
  await removeToken();
}
