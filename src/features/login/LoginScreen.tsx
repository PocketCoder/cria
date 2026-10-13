import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/store';
import { useSettings } from '@/stores/settings';
import { createApiClient } from '@/api/client';
import { fetchCurrentUser } from '@/api/user';
import { loginWithPassword, isTotpRequired } from '@/api/login';
import { authLinkShare, SHARE_PASSWORD_REQUIRED_CODE } from '@/api/shareAuth';
import { parseShareInput } from '@/lib/shareInput';
import { ApiError } from '@/api/errors';
import {
  serverUrlSchema,
  makeShareUser,
  messageFor,
  type AuthMethod,
} from './loginHelpers';
import {
  LoginHeader,
  MethodTabs,
  ServerUrlField,
  CredentialFields,
  RememberOptions,
} from './LoginFields';

export function LoginScreen() {
  const signIn = useAuth((s) => s.signIn);
  const recentServers = useSettings((s) => s.recentServers);
  const rememberServerUrl = useSettings((s) => s.rememberServer);
  const forgetServer = useSettings((s) => s.forgetServer);
  const lastServer = recentServers[0];
  const [authMethod, setAuthMethod] = useState<AuthMethod>(lastServer?.username ? 'password' : 'token');
  const [serverUrl, setServerUrl] = useState(lastServer?.url ?? '');
  const [rememberServer, setRememberServer] = useState(true);
  const [rememberMe, setRememberMe] = useState(true);
  const [token, setToken] = useState('');
  const [username, setUsername] = useState(lastServer?.username ?? '');
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

  const pickServer = (r: { url: string; username?: string }) => {
    setServerUrl(r.url);
    setServerUrlError(undefined);
    if (r.username) setUsername(r.username);
  };

  // Called once the server has accepted the credentials. Username is only kept
  // for password logins, and only with "Remember me" ticked.
  const remember = (url: string, user?: string) => {
    if (!rememberServer) return;
    rememberServerUrl(url, rememberMe ? user : undefined);
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
    remember(url, user);
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
        remember(url);
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
        const shareUser = makeShareUser(hash);
        remember(url);
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
    <main className="flex min-h-full items-center justify-center bg-[var(--color-background)] p-6">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-8 text-center shadow-sm">
        <LoginHeader />

        <MethodTabs authMethod={authMethod} onSwitch={switchMethod} />

        <form onSubmit={onSubmit} className="space-y-4 text-left">
          <ServerUrlField
            value={serverUrl}
            onChange={setServerUrl}
            error={serverUrlError}
            recents={recentServers}
            onPick={pickServer}
            onForget={forgetServer}
          />

          <CredentialFields
            authMethod={authMethod}
            token={token}
            setToken={setToken}
            shareLink={shareLink}
            setShareLink={setShareLink}
            sharePasswordRequired={sharePasswordRequired}
            sharePassword={sharePassword}
            setSharePassword={setSharePassword}
            username={username}
            setUsername={setUsername}
            password={password}
            setPassword={setPassword}
            totpRequired={totpRequired}
            totpCode={totpCode}
            setTotpCode={setTotpCode}
          />

          <RememberOptions
            rememberServer={rememberServer}
            setRememberServer={setRememberServer}
            rememberMe={rememberMe}
            setRememberMe={setRememberMe}
            showRememberMe={authMethod === 'password'}
          />

          {submitError ? (
            <div
              role="alert"
              className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]"
            >
              {submitError}
            </div>
          ) : null}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[var(--color-inverse)] text-[var(--color-inverse-foreground)]"
          >
            {isSubmitting
              ? 'Signing in…'
              : totpRequired
                ? 'Verify'
                : 'Continue'}
          </Button>

          <p className="text-center text-[12.5px] text-[var(--color-muted-foreground)]">
            No account yet?{' '}
            <button
              type="button"
              onClick={() => setServerUrl('https://try.vikunja.io')}
              className="text-[var(--color-primary)] underline underline-offset-2"
            >
              Use try.vikunja.io
            </button>
          </p>
        </form>
      </div>
    </main>
  );
}
