import { createApiFetch } from './client';
import { buildApiError, NetworkError } from './errors';

/** A login session on the server (`GET /user/sessions`). Not in the generated schema. */
export interface Session {
  id: string;
  deviceInfo: string;
  ipAddress: string;
  lastActive: string | null;
  created: string | null;
}

interface SessionPayload {
  id?: string;
  device_info?: string;
  ip_address?: string;
  last_active?: string;
  created?: string;
}

/** Sort key: undated sessions sink to the bottom. */
const activeMs = (s: Session): number => (s.lastActive ? Date.parse(s.lastActive) : 0);

const dateOrNull = (v: string | undefined) => (v && !v.startsWith('0001-') ? v : null);

/**
 * The user's sessions, most recently active first. Resolves to null when the
 * server has no sessions route (older Vikunja), so callers can hide the UI.
 */
export async function listSessions(): Promise<Session[] | null> {
  const api = createApiFetch();
  let res: Response;
  try {
    res = await api('/user/sessions?per_page=50');
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : String(err), err);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw buildApiError(res.status, await res.text().catch(() => ''));
  const data = (await res.json()) as SessionPayload[] | null;
  return (data ?? [])
    .filter((s): s is SessionPayload & { id: string } => typeof s.id === 'string')
    .map((s) => ({
      id: s.id,
      deviceInfo: s.device_info ?? '',
      ipAddress: s.ip_address ?? '',
      lastActive: dateOrNull(s.last_active),
      created: dateOrNull(s.created),
    }))
    .sort((a, b) => activeMs(b) - activeMs(a));
}

export async function revokeSession(id: string): Promise<void> {
  const api = createApiFetch();
  let res: Response;
  try {
    res = await api(`/user/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : String(err), err);
  }
  if (!res.ok) throw buildApiError(res.status, await res.text().catch(() => ''));
}

/**
 * The session id (`sid` claim) of a password-login JWT, or null for API tokens
 * and anything that isn't a decodable JWT.
 */
export function currentSessionId(token: string | null | undefined): string | null {
  const part = token?.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    const sid = (JSON.parse(json) as { sid?: unknown }).sid;
    return typeof sid === 'string' && sid ? sid : null;
  } catch {
    return null;
  }
}

/** A short device label from a User-Agent string ("Cria on macOS"). */
export function describeDevice(userAgent: string): string {
  if (!userAgent.trim()) return 'Unknown device';
  const os = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Windows/.test(userAgent)
            ? 'Windows'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : null;
  const app = /Firefox\//.test(userAgent)
    ? 'Firefox'
    : /Edg\//.test(userAgent)
      ? 'Edge'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : /AppleWebKit/.test(userAgent)
            ? 'Cria'
            : null;
  if (app && os) return `${app} on ${os}`;
  return app ?? os ?? userAgent.slice(0, 40);
}
