import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/auth/store';
import { useCurrentUser } from '@/queries/user';
import { useServerVersion } from '@/queries/server';
import { useUpdater } from '@/queries/updater';
import { useSettings, type DateFormat, type TimeFormat } from '@/stores/settings';
import { pushUserSettings, type UserSettingsInput } from '@/api/userSettings';
import { notify } from '@/db/bus';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';
import { isPermissionGranted, requestPermission } from '@/tauri/notification';
import { isEnabled, enable, disable } from '@/tauri/autostart';
import { openNotificationSettings } from '@/utils/notify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
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

  // The full settings object last known from the server. Every change we
  // POST is merged on top of this so the request carries the complete
  // object — the server overwrites all columns from the body, so a partial
  // payload would blank the fields we leave out (see pushSettings).
  const settingsRef = useRef<UserSettingsInput>({});

  // Seed local state + the server snapshot from the user object.
  useEffect(() => {
    if (!user) return;
    const raw = user.raw as Record<string, unknown> | undefined;
    const settings = (raw?.settings as UserSettingsInput | undefined) ?? {};
    // Server values as the base; anything already changed in this session
    // (held in settingsRef) wins so a background user refetch can't clobber
    // an unsaved edit. `name` lives at the top level of the user payload,
    // not inside settings.
    settingsRef.current = {
      ...settings,
      name: settings.name ?? user.name ?? undefined,
      ...settingsRef.current,
    };
    if (user.name) setDisplayName(user.name);
    if (settings.email_reminders_enabled === false) setEmailRemindersEnabled(false);
    if (settings.overdue_tasks_reminders_enabled === false) setOverdueRemindersEnabled(false);
    if (typeof settings.overdue_tasks_reminders_time === 'string') setOverdueRemindersTime(settings.overdue_tasks_reminders_time);
  }, [user]);

  const [autostartEnabled, setAutostartEnabled] = useState<boolean>(false);
  const [osPermissionGranted, setOsPermissionGranted] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(true);
  const [overdueRemindersEnabled, setOverdueRemindersEnabled] = useState(true);
  const [overdueRemindersTime, setOverdueRemindersTime] = useState('08:00');

  const notificationsEnabled = useSettings((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettings((s) => s.setNotificationsEnabled);
  const colorScheme = useSettings((s) => s.colorScheme);
  const setColorScheme = useSettings((s) => s.setColorScheme);
  const dateFormat = useSettings((s) => s.dateFormat);
  const setDateFormat = useSettings((s) => s.setDateFormat);
  const trayIconEnabled = useSettings((s) => s.trayIconEnabled);
  const setTrayIconEnabledInStore = useSettings((s) => s.setTrayIconEnabled);
  const timeFormat = useSettings((s) => s.timeFormat);
  const setTimeFormat = useSettings((s) => s.setTimeFormat);
  const playSoundWhenDone = useSettings((s) => s.playSoundWhenDone);
  const setPlaySoundWhenDone = useSettings((s) => s.setPlaySoundWhenDone);

  useEffect(() => {
    isEnabled().then(setAutostartEnabled).catch(() => setAutostartEnabled(false));
  }, []);

  useEffect(() => {
    isPermissionGranted().then(setOsPermissionGranted).catch(() => setOsPermissionGranted(false));
  }, []);

  // Merge a single change into the server snapshot and POST the whole
  // object. Vikunja's /user/settings/general overwrites every column from
  // the body, so we must always send the complete settings.
  const pushSettings = (patch: UserSettingsInput) => {
    settingsRef.current = { ...settingsRef.current, ...patch };
    return pushUserSettings(settingsRef.current);
  };

  const handleDateFormatChange = (fmt: string) => {
    setDateFormat(fmt as DateFormat);
  };

  const handleTimeFormatChange = (fmt: string) => {
    setTimeFormat(fmt as TimeFormat);
  };

  const handleNameSave = () => {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === user?.name) return;
    void pushSettings({ name: trimmed })
      // Refresh the cached user so the header reflects the new name now,
      // rather than after the 60s staleTime. The bus invalidates ['user'],
      // which refetches from the server (where the name was just saved).
      .then(() => notify('user'))
      .catch((e) => console.error('Failed to sync name to server', e));
  };

  const handleEmailRemindersToggle = (enabled: boolean) => {
    setEmailRemindersEnabled(enabled);
    void pushSettings({ email_reminders_enabled: enabled }).catch((e) =>
      console.error('Failed to sync email reminders setting', e),
    );
  };

  const handleOverdueRemindersToggle = (enabled: boolean) => {
    setOverdueRemindersEnabled(enabled);
    if (!enabled) {
      void pushSettings({
        overdue_tasks_reminders_enabled: false,
      }).catch((e) => console.error('Failed to sync overdue reminders setting', e));
    } else {
      void pushSettings({
        overdue_tasks_reminders_enabled: true,
        overdue_tasks_reminders_time: overdueRemindersTime,
      }).catch((e) => console.error('Failed to sync overdue reminders setting', e));
    }
  };

  const handleOverdueRemindersTimeChange = (time: string) => {
    setOverdueRemindersTime(time);
    if (overdueRemindersEnabled) {
      void pushSettings({ overdue_tasks_reminders_time: time }).catch((e) =>
        console.error('Failed to sync overdue reminders time', e),
      );
    }
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
                  <span className="max-w-[60%] truncate text-[var(--color-foreground)]">{user?.name || user?.username || '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onBlur={handleNameSave}
                    placeholder="Display name"
                    className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                  />
                  <Button variant="outline" size="sm" onClick={handleNameSave}>Save</Button>
                </div>
                <Button variant="destructive" size="sm" className="mt-1 w-full" onClick={() => void signOut()}>
                  Sign Out
                </Button>
              </div>
            </section>

            {/* ── General ── */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">General</h3>
              <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
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
                <div className="flex items-center justify-between">
                  <Label>Time Format</Label>
                  <select
                    value={timeFormat}
                    onChange={(e) => handleTimeFormatChange(e.target.value)}
                    className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                  >
                    <option value="24h">24-hour</option>
                    <option value="12h">12-hour</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Email reminders</Label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={emailRemindersEnabled}
                    onClick={() => handleEmailRemindersToggle(!emailRemindersEnabled)}
                    className={cn(
                      'relative h-5 w-9 rounded-full transition-colors',
                      emailRemindersEnabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-muted-foreground)]',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                        emailRemindersEnabled && 'translate-x-4',
                      )}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Overdue reminder email</Label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={overdueRemindersEnabled}
                    onClick={() => handleOverdueRemindersToggle(!overdueRemindersEnabled)}
                    className={cn(
                      'relative h-5 w-9 rounded-full transition-colors',
                      overdueRemindersEnabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-muted-foreground)]',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                        overdueRemindersEnabled && 'translate-x-4',
                      )}
                    />
                  </button>
                </div>
                {overdueRemindersEnabled && (
                  <div className="flex items-center justify-between">
                    <Label>Overdue reminder time</Label>
                    <input
                      type="time"
                      value={overdueRemindersTime}
                      onChange={(e) => handleOverdueRemindersTimeChange(e.target.value)}
                      className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                    />
                  </div>
                )}
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
                <div className="flex items-center justify-between">
                  <Label>Play sound when task is completed</Label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={playSoundWhenDone}
                    onClick={() => setPlaySoundWhenDone(!playSoundWhenDone)}
                    className={cn(
                      'relative h-5 w-9 rounded-full transition-colors',
                      playSoundWhenDone ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-muted-foreground)]',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                        playSoundWhenDone && 'translate-x-4',
                      )}
                    />
                  </button>
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
                        return;
                      }
                      // Enabling: make sure the OS will allow it. A single
                      // requestPermission() covers every case — it shows the
                      // dialog the first time and is a silent read afterwards
                      // (granted or denied), so there's no need to call it
                      // twice. If permission is already known-granted, skip it.
                      const granted =
                        osPermissionGranted ?? (await requestPermission()) === 'granted';
                      setOsPermissionGranted(granted);
                      setNotificationsEnabled(granted);
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
                {osPermissionGranted === false && notificationsEnabled && (
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
                    onClick={() => {
                      const newVal = !trayIconEnabled;
                      setTrayIconEnabledInStore(newVal);
                      void invoke('set_tray_visible', { visible: newVal });
                    }}
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
