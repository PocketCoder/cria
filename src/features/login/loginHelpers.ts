import { z } from 'zod';
import { ApiError, NetworkError } from '@/api/errors';
import type { User } from '@/domain/user';

export const serverUrlSchema = z.string().trim().url().refine(
  (url) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:') return true;
      return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    } catch { return false; }
  },
  'Use https:// or a loopback address (localhost/127.0.0.1) for http://',
);

export type AuthMethod = 'token' | 'password' | 'share';

/**
 * Link-share sessions have no real account behind them — a synthetic user
 * keeps the rest of the app (which expects one) working; account-only chrome
 * is hidden via isLinkShareSession.
 */
export function makeShareUser(hash: string): User {
  return {
    serverId: 0,
    username: `link-share-${hash}`,
    email: null,
    name: 'Shared project',
    raw: {},
    fetchedAt: new Date().toISOString(),
    defaultProjectId: null,
    language: '',
    timezone: '',
    weekStart: 1,
  };
}

export function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return 'That was rejected. Double-check your credentials.';
    }
    if (err.status === 404) {
      return "Couldn't find a Vikunja API at that URL — is /api/v1 reachable?";
    }
    return err.message || `Server returned HTTP ${err.status}.`;
  }
  if (err instanceof NetworkError) {
    return "Couldn't reach the server. Check the URL and your connection.";
  }
  return err instanceof Error ? err.message : 'Sign-in failed.';
}
