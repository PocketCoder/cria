/**
 * Credential storage.
 *
 * v1: backed by the webview's localStorage, which Tauri persists to a
 * per-app sandboxed directory inside the OS-managed app data dir
 * (per-user filesystem permissions, no network exposure).
 *
 * Security model: identical to the SQLite database the spec adopts in §15
 * ("rely on OS-level disk encryption"). The token is at rest in plaintext
 * inside the app data dir. An attacker with read access to that directory
 * has the token; OS file permissions are the perimeter.
 *
 * Upgrade path (M4): swap in an OS-keychain-backed Tauri command (keyring-rs
 * or @tauri-apps/plugin-keyring) so the snapshot file alone is useless.
 *
 * Why not Stronghold (which the spec lists first)? Its load/save round-trips
 * were observed to take *minutes* during M0 bring-up on this machine and
 * blocking every sign-in / startup on those is unacceptable for v1.
 */

export const STORAGE_KEY = 'cria:credentials/v1';

export interface Credentials {
  serverUrl: string;
  token: string;
  authMethod: 'token' | 'password';
}

export function loadCredentials(): Credentials | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Credentials>;
    if (typeof parsed.serverUrl !== 'string' || typeof parsed.token !== 'string') {
      return null;
    }
    return {
      serverUrl: parsed.serverUrl,
      token: parsed.token,
      authMethod: parsed.authMethod === 'password' ? 'password' : 'token',
    };
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

export function clearCredentials(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
