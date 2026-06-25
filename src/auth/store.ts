import { create } from 'zustand';
import { upsertUser, clearUser } from '@/db/user';
import type { User } from '@/domain/user';
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  type Credentials,
} from './storage';

export type AuthStatus =
  | { kind: 'unknown' }
  | { kind: 'unauthenticated' }
  | { kind: 'authenticated'; credentials: Credentials };

interface AuthState {
  status: AuthStatus;
  hydrate: () => Promise<void>;
  signIn: (credentials: Credentials, user: User) => Promise<void>;
  /** Swap in a freshly-refreshed JWT (and rotated refresh token) without
   *  touching the cached user. No-op if not currently authenticated. */
  updateSession: (token: string, refreshToken: string | null) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: { kind: 'unknown' },
  async hydrate() {
    const creds = await loadCredentials();
    set({
      status: creds
        ? { kind: 'authenticated', credentials: creds }
        : { kind: 'unauthenticated' },
    });
  },
  async signIn(credentials, user) {
    await saveCredentials(credentials);
    await upsertUser(user);
    set({ status: { kind: 'authenticated', credentials } });
  },
  async updateSession(token, refreshToken) {
    const s = get().status;
    if (s.kind !== 'authenticated') return;
    const credentials: Credentials = {
      ...s.credentials,
      token,
      refreshToken: refreshToken ?? s.credentials.refreshToken,
    };
    await saveCredentials(credentials);
    set({ status: { kind: 'authenticated', credentials } });
  },
  async signOut() {
    await clearCredentials();
    await clearUser();
    set({ status: { kind: 'unauthenticated' } });
  },
}));

/** Synchronous snapshot for non-React code (API client construction). */
export function getAuthSnapshot(): {
  serverUrl: string | null;
  token: string | null;
} {
  const s = useAuth.getState().status;
  if (s.kind === 'authenticated') {
    return { serverUrl: s.credentials.serverUrl, token: s.credentials.token };
  }
  return { serverUrl: null, token: null };
}
