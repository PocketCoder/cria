import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/auth/store';
import { createApiClient } from '@/api/client';
import { fetchCurrentUser } from '@/api/user';
import { loginWithPassword, isTotpRequired } from '@/api/login';
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

const formSchema = z.object({
  serverUrl: serverUrlSchema,
  token: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;
type AuthMethod = 'token' | 'password';

export function LoginScreen() {
  const signIn = useAuth((s) => s.signIn);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('token');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      serverUrl: 'https://try.vikunja.io',
      token: '',
      username: '',
      password: '',
    },
  });

  const switchMethod = (method: AuthMethod) => {
    setAuthMethod(method);
    setSubmitError(null);
    setTotpRequired(false);
    setTotpCode('');
    form.clearErrors();
  };

  const doPasswordSignIn = async (
    serverUrl: string,
    username: string,
    password: string,
    totp_passcode?: string,
  ) => {
    const token = await loginWithPassword(serverUrl, {
      username,
      password,
      long_token: true,
      totp_passcode,
    });
    const client = createApiClient({ baseUrl: serverUrl, token });
    const user = await fetchCurrentUser(client);
    await signIn({ serverUrl, token, authMethod: 'password' }, user);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);

    if (authMethod === 'token') {
      if (!values.token || values.token.trim().length < 8) {
        setSubmitError('Paste your API token from Vikunja settings.');
        return;
      }
      try {
        const client = createApiClient({ baseUrl: values.serverUrl, token: values.token });
        const user = await fetchCurrentUser(client);
        await signIn({ serverUrl: values.serverUrl, token: values.token, authMethod: 'token' }, user);
      } catch (err) {
        console.error('[login] token sign-in failed:', err);
        setSubmitError(messageFor(err));
      }
      return;
    }

    if (!values.username || !values.password) {
      setSubmitError('Enter your username and password.');
      return;
    }

    if (totpRequired) {
      try {
        await doPasswordSignIn(values.serverUrl, values.username, values.password, totpCode || undefined);
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
      await doPasswordSignIn(values.serverUrl, values.username, values.password);
    } catch (err) {
      if (isTotpRequired(err)) {
        setTotpRequired(true);
        setSubmitError(null);
        return;
      }
      console.error('[login] password sign-in failed:', err);
      setSubmitError(messageFor(err));
    }
  });

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-sm">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Vikunja</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {authMethod === 'token'
              ? 'Connect Cria to your Vikunja instance with an API token.'
              : 'Sign in with your Vikunja username or email and password.'}
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
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="serverUrl">Server URL</Label>
            <Input
              id="serverUrl"
              autoComplete="url"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="https://vikunja.example.com"
              {...form.register('serverUrl')}
            />
            <FieldError message={form.formState.errors.serverUrl?.message as string | undefined} />
          </div>

          {authMethod === 'token' ? (
            <div className="space-y-2">
              <Label htmlFor="token">API token</Label>
              <Input
                id="token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="tk_…"
                {...form.register('token')}
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Create one in Vikunja's web UI under Settings → API Tokens.
              </p>
            </div>
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
                  {...form.register('username')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="loginPassword">Password</Label>
                <Input
                  id="loginPassword"
                  type="password"
                  autoComplete="current-password"
                  spellCheck={false}
                  {...form.register('password')}
                />
              </div>

              {totpRequired && (
                <div className="space-y-2">
                  <Label htmlFor="totp">Two-factor code</Label>
                  <Input
                    id="totp"
                    type="text"
                    inputMode="numeric"
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

          <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
            {form.formState.isSubmitting
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