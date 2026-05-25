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
import { ApiError, NetworkError } from '@/api/errors';

const schema = z.object({
  serverUrl: z
    .string()
    .trim()
    .url('Enter a full URL (https://…) to your Vikunja instance'),
  token: z.string().trim().min(8, 'Paste your API token from Vikunja settings'),
});

type FormValues = z.infer<typeof schema>;

export function LoginScreen() {
  const signIn = useAuth((s) => s.signIn);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      serverUrl: 'https://try.vikunja.io',
      token: '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const client = createApiClient({
        baseUrl: values.serverUrl,
        token: values.token,
      });
      const user = await fetchCurrentUser(client);
      await signIn(values, user);
    } catch (err) {
      console.error('[login] sign-in failed:', err);
      setSubmitError(messageFor(err));
    }
  });

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-sm">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Vikunja</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Connect Cria to your Vikunja instance with an API token.
          </p>
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
            <FieldError message={form.formState.errors.serverUrl?.message} />
          </div>

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
            <FieldError message={form.formState.errors.token?.message} />
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Create one in Vikunja's web UI under Settings → API Tokens.
            </p>
          </div>

          {submitError ? (
            <div
              role="alert"
              className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]"
            >
              {submitError}
            </div>
          ) : null}

          <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
            {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
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
      return 'That token was rejected. Double-check it in Vikunja settings.';
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
