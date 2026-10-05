import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import appIcon from '@/assets/app-icon.png';
import type { RecentServer } from '@/stores/settings';
import type { AuthMethod } from './loginHelpers';

export function LoginHeader() {
  return (
    <div className="flex flex-col items-center space-y-2">
      <img src={appIcon} alt="" className="mb-2 h-14 w-14 rounded-[14px]" />
      <h1 className="text-2xl font-semibold tracking-[-0.03em]">Point Cria at your Vikunja</h1>
      <p className="mx-auto max-w-[42ch] text-[14.5px] leading-relaxed text-[var(--color-muted-foreground)]">
        Everything is stored on your machine and synced in the background. Works offline from the first launch.
      </p>
    </div>
  );
}

const AUTH_METHODS: { value: AuthMethod; label: string }[] = [
  { value: 'token', label: 'API Token' },
  { value: 'password', label: 'Username & Password' },
  { value: 'share', label: 'Share link' },
];

export function MethodTabs({
  authMethod,
  onSwitch,
}: {
  authMethod: AuthMethod;
  onSwitch: (method: AuthMethod) => void;
}) {
  return (
    <SegmentedControl
      aria-label="Sign-in method"
      variant="primary"
      fill
      options={AUTH_METHODS}
      value={authMethod}
      onChange={onSwitch}
    />
  );
}

export function ServerUrlField({
  value,
  onChange,
  error,
  recents = [],
  onPick,
  onForget,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | undefined;
  recents?: RecentServer[];
  onPick?: (server: RecentServer) => void;
  onForget?: (url: string) => void;
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
      {recents.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Recent servers">
          {recents.map((r) => (
            <span
              key={r.url}
              className="inline-flex items-center rounded-full border border-[var(--color-border)] text-xs"
            >
              <button
                type="button"
                onClick={() => onPick?.(r)}
                title={r.username ? `${r.url} (${r.username})` : r.url}
                className="max-w-[16rem] truncate rounded-l-full py-1 pl-2.5 pr-1.5 hover:bg-[var(--color-muted)]"
              >
                {r.url.replace(/^https?:\/\//, '')}
              </button>
              <button
                type="button"
                onClick={() => onForget?.(r.url)}
                aria-label={`Forget ${r.url}`}
                className="rounded-r-full py-1 pl-1 pr-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function RememberOptions({
  rememberServer,
  setRememberServer,
  rememberMe,
  setRememberMe,
  showRememberMe,
}: {
  rememberServer: boolean;
  setRememberServer: (v: boolean) => void;
  rememberMe: boolean;
  setRememberMe: (v: boolean) => void;
  showRememberMe: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-[var(--color-primary)]"
          checked={rememberServer}
          onChange={(e) => setRememberServer(e.target.checked)}
        />
        Remember server
      </label>
      {showRememberMe && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-[var(--color-primary)]"
            checked={rememberServer && rememberMe}
            disabled={!rememberServer}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          Remember me
        </label>
      )}
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
