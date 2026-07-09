import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/auth/store';
import { createApiClient } from '@/api/client';
import { fetchCurrentUser } from '@/api/user';
import { loginWithPassword, isTotpRequired } from '@/api/login';
import { authLinkShare, SHARE_PASSWORD_REQUIRED_CODE } from '@/api/shareAuth';
import { parseShareInput } from '@/lib/shareInput';
import type { User } from '@/domain/user';
import { ApiError, NetworkError } from '@/api/errors';

const serverUrlSchema = z.string().trim().url().refine(
  (url) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:') return true;
      return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    } catch { return false; }
  },
  'Use https:// or a loopback address (localhost/127.0.0.1) for http://',
);

type AuthMethod = 'token' | 'password' | 'share';

export function LoginScreen() {
  const signIn = useAuth((s) => s.signIn);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('token');
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverUrlError, setServerUrlError] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [sharePassword, setSharePassword] = useState('');
  const [sharePasswordRequired, setSharePasswordRequired] = useState(false);

  const switchMethod = (method: AuthMethod) => {
    setAuthMethod(method);
    setSubmitError(null);
    setTotpRequired(false);
    setTotpCode('');
    setServerUrlError(undefined);
  };

  const doPasswordSignIn = async (
    url: string,
    user: string,
    pass: string,
    totp_passcode?: string,
  ) => {
    const { token: t, refreshToken } = await loginWithPassword(url, {
      username: user,
      password: pass,
      long_token: true,
      totp_passcode,
    });
    const client = createApiClient({ baseUrl: url, token: t });
    const me = await fetchCurrentUser(client);
    await signIn(
      { serverUrl: url, token: t, refreshToken: refreshToken ?? undefined, authMethod: 'password' },
      me,
    );
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    // Server URL is the only field with structural validation (the rest are
    // checked per-method below). Reuse the trimmed/normalised value zod returns.
    const parsed = serverUrlSchema.safeParse(serverUrl);
    if (!parsed.success) {
      setServerUrlError(parsed.error.issues[0]?.message ?? 'Enter a valid server URL.');
      return;
    }
    setServerUrlError(undefined);
    const url = parsed.data;

    if (authMethod === 'token') {
      if (!token || token.trim().length < 8) {
        setSubmitError('Paste your API token from Vikunja settings.');
        return;
      }
      setIsSubmitting(true);
      try {
        const client = createApiClient({ baseUrl: url, token });
        const user = await fetchCurrentUser(client);
        await signIn({ serverUrl: url, token, authMethod: 'token' }, user);
      } catch (err) {
        console.error('[login] token sign-in failed:', err);
        setSubmitError(messageFor(err));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (authMethod === 'share') {
      const hash = parseShareInput(shareLink);
      if (!hash) {
        setSubmitError('Paste a share link or its code.');
        return;
      }
      setIsSubmitting(true);
      try {
        const { token: shareToken } = await authLinkShare(
          url,
          hash,
          sharePassword || undefined,
        );
        // Link-share sessions have no real account behind them — a
        // synthetic user keeps the rest of the app (which expects one)
        // working; account-only chrome is hidden via isLinkShareSession.
        const shareUser: User = {
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
        await signIn(
          { serverUrl: url, token: shareToken, authMethod: 'linkShare' },
          shareUser,
        );
      } catch (err) {
        if (err instanceof ApiError && err.code === SHARE_PASSWORD_REQUIRED_CODE) {
          setSharePasswordRequired(true);
          setSubmitError(sharePassword ? 'Wrong password for this share.' : 'This share needs a password.');
        } else {
          console.error('[login] share sign-in failed:', err);
          setSubmitError(messageFor(err));
        }
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!username || !password) {
      setSubmitError('Enter your username and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (totpRequired) {
        try {
          await doPasswordSignIn(url, username, password, totpCode || undefined);
        } catch (err) {
          console.error('[login] password+TOTP sign-in failed:', err);
          if (isTotpRequired(err)) {
            setSubmitError('Invalid two-factor code. Try again.');
          } else {
            setSubmitError(messageFor(err));
            setTotpRequired(false);
            setTotpCode('');
          }
        }
        return;
      }

      try {
        await doPasswordSignIn(url, username, password);
      } catch (err) {
        if (isTotpRequired(err)) {
          setTotpRequired(true);
          setSubmitError(null);
          return;
        }
        console.error('[login] password sign-in failed:', err);
        setSubmitError(messageFor(err));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-sm">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Vikunja</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {authMethod === 'token'
              ? 'Connect Cria to your Vikunja instance with an API token.'
              : authMethod === 'password'
                ? 'Sign in with your Vikunja username or email and password.'
                : 'Open a project someone shared with you via a link.'}
          </p>
        </div>

        <div className="flex rounded-lg border border-[var(--color-border)] p-0.5">
          <button
            type="button"
            onClick={() => switchMethod('token')}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
              authMethod === 'token'
                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
            }`}
          >
            API Token
          </button>
          <button
            type="button"
            onClick={() => switchMethod('password')}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
              authMethod === 'password'
                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
            }`}
          >
            Username &amp; Password
          </button>
          <button
            type="button"
            onClick={() => switchMethod('share')}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
              authMethod === 'share'
                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
            }`}
          >
            Share link
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="serverUrl">Server URL</Label>
            <Input
              id="serverUrl"
              type="url"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="https://vikunja.example.com"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
            />
            <FieldError message={serverUrlError} />
          </div>

          {authMethod === 'token' ? (
            <div className="space-y-2">
              <Label htmlFor="apiToken">API token</Label>
              <Input
                id="apiToken"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="tk_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Create one in Vikunja's web UI under Settings → API Tokens.
              </p>
            </div>
          ) : authMethod === 'share' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="shareLink">Share link or code</Label>
                <Input
                  id="shareLink"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://vikunja.example.com/share/…/auth"
                  value={shareLink}
                  onChange={(e) => setShareLink(e.target.value)}
                />
              </div>
              {sharePasswordRequired && (
                <div className="space-y-2">
                  <Label htmlFor="sharePassword">Share password</Label>
                  <Input
                    id="sharePassword"
                    type="password"
                    autoComplete="off"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="loginUsername">Username or email</Label>
                <Input
                  id="loginUsername"
                  autoComplete="username"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="jane@example.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="loginPassword">Password</Label>
                <Input
                  id="loginPassword"
                  type="password"
                  autoComplete="current-password"
                  spellCheck={false}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {totpRequired && (
                <div className="space-y-2">
                  <Label htmlFor="token">Two-factor code</Label>
                  <Input
                    id="token"
                    name="token"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    autoFocus
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Enter the code from your authenticator app.
                  </p>
                </div>
              )}
            </>
          )}

          {submitError ? (
            <div
              role="alert"
              className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]"
            >
              {submitError}
            </div>
          ) : null}

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting
              ? 'Signing in…'
              : totpRequired
                ? 'Verify'
                : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}

function FieldError({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return <p className="text-xs text-[var(--color-destructive)]">{message}</p>;
}

function messageFor(err: unknown): string {
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
