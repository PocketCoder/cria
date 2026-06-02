import { useState, useEffect } from 'react';
import { useAuth } from '@/auth/store';
import { useCurrentUser } from '@/queries/user';
import { useServerVersion } from '@/queries/server';
import { useUpdater } from '@/queries/updater';
import { useSettings, type DateFormat } from '@/stores/settings';
import { pushUserSettings } from '@/api/userSettings';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';
import { isPermissionGranted, requestPermission } from '@/tauri/notification';
import { isEnabled, enable, disable } from '@/tauri/autostart';
import { openNotificationSettings } from '@/utils/notify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { X, ExternalLink, Settings } from 'lucide-react';
import pkg from '../../package.json';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const status = useAuth((s) => s.status);
  const signOut = useAuth((s) => s.signOut);
  const { data: user } = useCurrentUser();
  const { data: serverVersion } = useServerVersion();
  const { state: updaterState, runCheck: runUpdaterCheck } = useUpdater();

  const serverUrl = status.kind === 'authenticated' ? status.credentials.serverUrl : null;

  const [trayIconEnabled, setTrayIconEnabled] = useState(true);
  const [autostartEnabled, setAutostartEnabled] = useState<boolean>(false);
  const [osPermissionGranted, setOsPermissionGranted] = useState<boolean | null>(null);

  const notificationsEnabled = useSettings((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettings((s) => s.setNotificationsEnabled);
  const colorScheme = useSettings((s) => s.colorScheme);
  const setColorScheme = useSettings((s) => s.setColorScheme);
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);
  const timezone = useSettings((s) => s.timezone);
  const setTimezone = useSettings((s) => s.setTimezone);
  const dateFormat = useSettings((s) => s.dateFormat);
  const setDateFormat = useSettings((s) => s.setDateFormat);

  useEffect(() => {
    isEnabled().then(setAutostartEnabled).catch(() => setAutostartEnabled(false));
  }, []);

  useEffect(() => {
    isPermissionGranted().then(setOsPermissionGranted).catch(() => setOsPermissionGranted(false));
  }, []);

  // Seed language/timezone from server if the store still has defaults.
  // This runs once per modal open; after the user changes a value the store
  // persists it and the guard below won't overwrite.
  useEffect(() => {
    if (language === 'en' && user?.language && user.language !== 'en') {
      setLanguage(user.language);
    }
    if (timezone === 'UTC' && user?.timezone && user.timezone !== 'UTC') {
      setTimezone(user.timezone);
    }
  }, []);

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    void pushUserSettings({ language: lang }).catch((e) =>
      console.error('Failed to sync language to server', e),
    );
  };

  const handleTimezoneChange = (tz: string) => {
    setTimezone(tz);
    void pushUserSettings({ timezone: tz }).catch((e) =>
      console.error('Failed to sync timezone to server', e),
    );
  };

  const handleDateFormatChange = (fmt: string) => {
    setDateFormat(fmt as DateFormat);
  };

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
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                  >
                    <option value="en">English</option>
                    <option value="de">Deutsch</option>
                    <option value="fr">Français</option>
                    <option value="es">Español</option>
                    <option value="nl">Nederlands</option>
                    <option value="pl">Polski</option>
                    <option value="pt-BR">Português (Brasil)</option>
                    <option value="ru">Русский</option>
                    <option value="zh">简体中文</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Timezone</Label>
                  <select
                    value={timezone}
                    onChange={(e) => handleTimezoneChange(e.target.value)}
                    className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                  >
                    <option value="UTC">UTC</option>
                    <option value="America/New_York">Eastern (US)</option>
                    <option value="America/Chicago">Central (US)</option>
                    <option value="America/Denver">Mountain (US)</option>
                    <option value="America/Los_Angeles">Pacific (US)</option>
                    <option value="America/Anchorage">Alaska</option>
                    <option value="Pacific/Honolulu">Hawaii</option>
                    <option value="America/Toronto">Eastern (CA)</option>
                    <option value="America/Vancouver">Pacific (CA)</option>
                    <option value="America/Mexico_City">Mexico City</option>
                    <option value="America/Sao_Paulo">Brasília</option>
                    <option value="America/Argentina/Buenos_Aires">Buenos Aires</option>
                    <option value="Europe/London">London</option>
                    <option value="Europe/Paris">Paris</option>
                    <option value="Europe/Berlin">Berlin</option>
                    <option value="Europe/Madrid">Madrid</option>
                    <option value="Europe/Rome">Rome</option>
                    <option value="Europe/Amsterdam">Amsterdam</option>
                    <option value="Europe/Stockholm">Stockholm</option>
                    <option value="Europe/Moscow">Moscow</option>
                    <option value="Europe/Istanbul">Istanbul</option>
                    <option value="Asia/Dubai">Dubai</option>
                    <option value="Asia/Kolkata">India</option>
                    <option value="Asia/Bangkok">Bangkok</option>
                    <option value="Asia/Shanghai">Shanghai</option>
                    <option value="Asia/Tokyo">Tokyo</option>
                    <option value="Asia/Seoul">Seoul</option>
                    <option value="Australia/Sydney">Sydney</option>
                    <option value="Australia/Auckland">Auckland</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Date Format</Label>
                  <select
                    value={dateFormat}
                    onChange={(e) => handleDateFormatChange(e.target.value)}
                    className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
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
                    onClick={async () => {
                      if (notificationsEnabled) {
                        setNotificationsEnabled(false);
                      } else {
                        const granted = osPermissionGranted
                          ?? await requestPermission().then((r) => r === 'granted');
                        if (granted) {
                          setNotificationsEnabled(true);
                        } else {
                          const requested = await requestPermission();
                          setNotificationsEnabled(requested === 'granted');
                          setOsPermissionGranted(requested === 'granted');
                        }
                      }
                    }}
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
                {!osPermissionGranted && notificationsEnabled && (
                  <p className="text-xs text-amber-500">
                    Notifications are disabled in System Settings. Turn them on below.
                  </p>
                )}
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
                  <button
                    type="button"
                    onClick={() => void openUrl('https://vikunja.io/help/caldav/')}
                    className="flex items-center gap-1 text-xs text-[var(--color-primary)] underline"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </button>
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
