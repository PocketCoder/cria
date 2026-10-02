import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthMethod } from './loginHelpers';

export function LoginHeader() {
  return (
    <div className="flex flex-col items-center space-y-2">
      <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-[13px] bg-[var(--color-inverse)] text-[var(--color-inverse-foreground)]">
        <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold tracking-[-0.03em]">Point Cria at your Vikunja</h1>
      <p className="mx-auto max-w-[42ch] text-[14.5px] leading-relaxed text-[var(--color-muted-foreground)]">
        Everything is stored on your machine and synced in the background. Works offline from the first launch.
      </p>
    </div>
  );
}

const TABS: { method: AuthMethod; label: React.ReactNode }[] = [
  { method: 'token', label: 'API Token' },
  { method: 'password', label: <>Username &amp; Password</> },
  { method: 'share', label: 'Share link' },
];

export function MethodTabs({
  authMethod,
  onSwitch,
}: {
  authMethod: AuthMethod;
  onSwitch: (method: AuthMethod) => void;
}) {
  return (
    <div className="flex rounded-lg border border-[var(--color-border)] p-0.5">
      {TABS.map(({ method, label }) => (
        <button
          key={method}
          type="button"
          onClick={() => onSwitch(method)}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
            authMethod === method
              ? 'bg-[var(--color-primary)] text-white shadow-sm'
              : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ServerUrlField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | undefined;
}) {
  return (
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldError message={error} />
    </div>
  );
}

interface CredentialFieldsProps {
  authMethod: AuthMethod;
  token: string;
  setToken: (v: string) => void;
  shareLink: string;
  setShareLink: (v: string) => void;
  sharePasswordRequired: boolean;
  sharePassword: string;
  setSharePassword: (v: string) => void;
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  totpRequired: boolean;
  totpCode: string;
  setTotpCode: (v: string) => void;
}

export function CredentialFields(props: CredentialFieldsProps) {
  if (props.authMethod === 'token') return <TokenFields {...props} />;
  if (props.authMethod === 'share') return <ShareFields {...props} />;
  return <PasswordFields {...props} />;
}

function TokenFields({ token, setToken }: CredentialFieldsProps) {
  return (
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
  );
}

function ShareFields({
  shareLink,
  setShareLink,
  sharePasswordRequired,
  sharePassword,
  setSharePassword,
}: CredentialFieldsProps) {
  return (
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
  );
}

function PasswordFields({
  username,
  setUsername,
  password,
  setPassword,
  totpRequired,
  totpCode,
  setTotpCode,
}: CredentialFieldsProps) {
  return (
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
  );
}

function FieldError({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return <p className="text-xs text-[var(--color-destructive)]">{message}</p>;
}
