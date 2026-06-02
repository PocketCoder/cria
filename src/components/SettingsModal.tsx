import { useState, useEffect } from 'react';
import { useAuth } from '@/auth/store';
import { useCurrentUser } from '@/queries/user';
import { useServerVersion } from '@/queries/server';
import { useUpdater } from '@/queries/updater';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';
import { isEnabled, enable, disable } from '@/tauri/autostart';
import { openNotificationSettings } from '@/utils/notify';
import { X, ExternalLink, Settings } from 'lucide-react';
import pkg from '../../package.json';

interface SettingsModalProps {
  onClose: () => void;
}

type ColorScheme = 'light' | 'dark' | 'system';

export function SettingsModal({ onClose }: SettingsModalProps) {
  const status = useAuth((s) => s.status);
  const signOut = useAuth((s) => s.signOut);
  const { data: user } = useCurrentUser();
  const { data: serverVersion } = useServerVersion();
  const { state: updaterState, runCheck: runUpdaterCheck } = useUpdater();

  const serverUrl = status.kind === 'authenticated' ? status.credentials.serverUrl : null;

  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState('UTC');
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
  const [colorScheme, setColorScheme] = useState<ColorScheme>('system');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [trayIconEnabled, setTrayIconEnabled] = useState(true);
  const [autostartEnabled, setAutostartEnabled] = useState<boolean>(false);

  useEffect(() => {
    isEnabled().then(setAutostartEnabled).catch(() => setAutostartEnabled(false));
  }, []);

  const handleAutostartToggle = async () => {
    try {
      const enabled = await isEnabled();
      if (enabled) {
        await disable();
      } else {
        await enable();
      }
      setAutostartEnabled(!(await isEnabled()));
    } catch (e) {
      console.error('Autostart toggle failed', e);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-[var(--color-background)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            <h2 className="text-base font-semibold">Settings</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-6">

            {/* ── Account ── */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Account</h3>
              <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--color-muted-foreground)]">Server</span>
                  <span className="max-w-[60%] truncate text-[var(--color-foreground)]">{serverUrl ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--color-muted-foreground)]">User</span>
                  <span className="text-[var(--color-foreground)]">{user?.name || user?.username || '—'}</span>
                </div>
                <Button variant="destructive" size="sm" className="mt-2 w-full" onClick={() => void signOut()}>
                  Sign Out
                </Button>
              </div>
            </section>

            {/* ── General ── */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">General</h3>
              <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between">
                  <Label>Language</Label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                  >
                    <option value="en">English</option>
                    <option value="de">Deutsch</option>
                    <option value="fr">Français</option>
                    <option value="ja">日本語</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Timezone</Label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                  >
                    <option value="UTC">UTC</option>
                    <option value="America/New_York">America/New_York</option>
                    <option value="Europe/London">Europe/London</option>
                    <option value="Asia/Tokyo">Asia/Tokyo</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Date Format</Label>
                  <select
                    value={dateFormat}
                    onChange={(e) => setDateFormat(e.target.value)}
                    className="w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                  >
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  </select>
                </div>
              </div>
            </section>

            {/* ── Appearance ── */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Appearance</h3>
              <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
                <Label>Color Scheme</Label>
                <div className="flex gap-2">
                  {(['light', 'dark', 'system'] as const).map((scheme) => (
                    <button
                      key={scheme}
                      onClick={() => setColorScheme(scheme)}
                      className={cn(
                        'flex-1 rounded-md border px-3 py-2 text-sm capitalize transition-colors',
                        colorScheme === scheme
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                          : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]',
                      )}
                    >
                      {scheme === 'system' ? 'Auto' : scheme}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* ── Shortcuts ── */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Shortcuts</h3>
              <div className="space-y-1 rounded-lg border border-[var(--color-border)] p-3">
                {[
                  { label: 'Quick Add', keys: '⌘+Shift+A' },
                  { label: 'Search', keys: '⌘+F' },
                  { label: 'Close panel / Cancel', keys: 'Esc' },
                ].map((shortcut) => (
                  <div key={shortcut.label} className="flex items-center justify-between py-1">
                    <span className="text-sm text-[var(--color-foreground)]">{shortcut.label}</span>
                    <span className="rounded bg-[var(--color-muted)] px-2 py-0.5 text-xs font-mono text-[var(--color-muted-foreground)]">
                      {shortcut.keys}
                    </span>
                  </div>
                ))}
                <p className="pt-2 text-xs text-[var(--color-muted-foreground)]">
                  Rebindable shortcuts coming in a future update.
                </p>
              </div>
            </section>

            {/* ── Notifications ── */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Notifications</h3>
              <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between">
                  <Label>Show desktop notifications</Label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notificationsEnabled}
                    onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                    className={cn(
                      'relative h-5 w-9 rounded-full transition-colors',
                      notificationsEnabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-muted-foreground)]',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                        notificationsEnabled && 'translate-x-4',
                      )}
                    />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void openNotificationSettings()}
                  className="flex items-center gap-1 text-xs text-[var(--color-primary)] underline"
                >
                  Open System Notification Settings
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>
            </section>

            {/* ── Advanced ── */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Advanced</h3>
              <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between">
                  <Label>Launch at login</Label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autostartEnabled}
                    onClick={handleAutostartToggle}
                    className={cn(
                      'relative h-5 w-9 rounded-full transition-colors',
                      autostartEnabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-muted-foreground)]',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                        autostartEnabled && 'translate-x-4',
                      )}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Show tray icon</Label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={trayIconEnabled}
                    onClick={() => setTrayIconEnabled(!trayIconEnabled)}
                    className={cn(
                      'relative h-5 w-9 rounded-full transition-colors',
                      trayIconEnabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-muted-foreground)]',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                        trayIconEnabled && 'translate-x-4',
                      )}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <Label>CalDAV Documentation</Label>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                    }}
                    className="flex items-center gap-1 text-xs text-[var(--color-primary)] underline"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Updates</Label>
                  <div className="flex items-center gap-2">
                    {updaterState.kind === 'checking' && (
                      <span className="text-xs text-[var(--color-muted-foreground)]">Checking…</span>
                    )}
                    {updaterState.kind === 'available' && (
                      <span className="text-xs text-green-500">Update available!</span>
                    )}
                    {updaterState.kind === 'error' && (
                      <span className="text-xs text-red-500">Check failed</span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runUpdaterCheck()}
                      disabled={updaterState.kind === 'checking'}
                    >
                      Check for Updates
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)]">
                  <span>Version</span>
                  <span>
                    Cria {pkg.version}
                    {serverVersion ? <span className="ml-2">· Server {serverVersion}</span> : null}
                  </span>
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}
