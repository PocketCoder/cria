import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/auth/store';
import { useCurrentUser } from '@/queries/user';
import { getAvatarSettings, setAvatarProvider, uploadAvatar, fetchAvatarBlob } from '@/api/account';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { notify } from '@/db/bus';
import type { UserSettingsInput } from '@/api/userSettings';

const AVATAR_PROVIDERS = [
  { value: 'default', label: 'Default' },
  { value: 'initials', label: 'Initials' },
  { value: 'gravatar', label: 'Gravatar' },
  { value: 'marble', label: 'Marble' },
  { value: 'upload', label: 'Upload' },
];

interface Props {
  disabled?: boolean;
  onPushSettings: (patch: UserSettingsInput) => Promise<void>;
}

export function AccountTab({ disabled, onPushSettings }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: user } = useCurrentUser();
  const signOut = useAuth((s) => s.signOut);
  const status = useAuth((s) => s.status);
  const serverUrl = status.kind === 'authenticated' ? status.credentials.serverUrl : null;

  const [displayName, setDisplayName] = useState('');
  const [avatarProvider, setAvatarProviderState] = useState('default');
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (user?.name) setDisplayName(user.name);
  }, [user?.name]);

  useEffect(() => {
    getAvatarSettings()
      .then((s) => setAvatarProviderState(s.avatar_provider ?? 'default'))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.username) {
      fetchAvatarBlob(user.username)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          setAvatarPreviewUrl(url);
          return () => URL.revokeObjectURL(url);
        })
        .catch(() => {});
    }
  }, [user?.username]);

  const handleNameSave = () => {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === user?.name) return;
    void onPushSettings({ name: trimmed })
      .then(() => notify('user'))
      .catch((e) => console.error('Failed to sync name', e));
  };

  const handleProviderChange = (value: string) => {
    setAvatarProviderState(value);
    void setAvatarProvider(value).catch((e) => console.error('Failed to set avatar', e));
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void uploadAvatar(file)
      .then(async () => {
        if (user?.username) {
          const blob = await fetchAvatarBlob(user.username);
          const url = URL.createObjectURL(blob);
          setAvatarPreviewUrl(url);
        }
      })
      .catch((err) => console.error('Failed to upload avatar', err));
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Account</h3>
      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
        {avatarPreviewUrl && (
          <div className="flex justify-center">
            <img src={avatarPreviewUrl} alt="Avatar" className="h-16 w-16 rounded-full border object-cover" />
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-muted-foreground)]">Server</span>
          <span className="max-w-[60%] truncate text-[var(--color-foreground)]">{serverUrl ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-muted-foreground)]">User</span>
          <span className="max-w-[60%] truncate text-[var(--color-foreground)]">{user?.name || user?.username || '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={handleNameSave}
            placeholder="Display name"
            disabled={disabled}
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)] disabled:opacity-50"
          />
          <Button variant="outline" size="sm" onClick={handleNameSave} disabled={disabled}>Save</Button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-muted-foreground)]">Avatar</span>
          <Select value={avatarProvider} onValueChange={handleProviderChange}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVATAR_PROVIDERS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {avatarProvider === 'upload' && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleUpload}
              disabled={disabled}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose image…
            </Button>
          </>
        )}
        <Button variant="destructive" size="sm" className="mt-1 w-full" onClick={() => void signOut()}>
          Sign Out
        </Button>
      </div>
    </section>
  );
}
