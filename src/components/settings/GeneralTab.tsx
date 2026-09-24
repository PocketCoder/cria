import { useState, useEffect } from 'react';
import { useCurrentUser } from '@/queries/user';
import { useSelectableProjects } from '@/queries/projects';
import { useSettings, type DateFormat, type TimeFormat } from '@/stores/settings';
import { listTimezones } from '@/api/account';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from '@/components/ui/select';
import { notify } from '@/db/bus';
import { frontendSettingsWithCria } from '@/sync/settingsSync';
import type { UserSettingsInput } from '@/api/userSettings';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt_BR', label: 'Português (Brasil)' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'ru', label: 'Русский' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'it', label: 'Italiano' },
  { code: 'sv', label: 'Svenska' },
  { code: 'cs', label: 'Čeština' },
  { code: 'uk', label: 'Українська' },
  { code: 'ca', label: 'Català' },
];

interface Props {
  disabled?: boolean;
  onPushSettings: (patch: UserSettingsInput) => Promise<void>;
}

function groupTimezones(timezones: string[]): { label: string; items: { value: string; label: string }[] }[] {
  const groups: Record<string, { value: string; label: string }[]> = {};
  for (const tz of timezones) {
    const label = tz.replace(/_/g, ' ');
    const slash = tz.indexOf('/');
    if (slash === -1) {
      (groups['Other'] ??= []).push({ value: tz, label });
    } else {
      const region = tz.slice(0, slash);
      (groups[region] ??= []).push({ value: tz, label: label.slice(slash + 1) });
    }
  }
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, items]) => ({
      label,
      items: items.sort((a, b) => a.label.localeCompare(b.label)),
    }));
}

interface FeedbackState {
  type: 'success' | 'error';
  message: string;
}

export function GeneralTab({ disabled, onPushSettings }: Props) {
  const { data: user } = useCurrentUser();
  const { data: projects = [] } = useSelectableProjects();
  const dateFormat = useSettings((s) => s.dateFormat);
  const setDateFormat = useSettings((s) => s.setDateFormat);
  const timeFormat = useSettings((s) => s.timeFormat);
  const setTimeFormat = useSettings((s) => s.setTimeFormat);

  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(true);
  const [overdueRemindersEnabled, setOverdueRemindersEnabled] = useState(true);
  const [overdueRemindersTime, setOverdueRemindersTime] = useState('08:00');
  const [weekStart, setWeekStart] = useState(1);
  const [defaultProjectId, setDefaultProjectId] = useState<number | null>(null);
  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState('UTC');
  const [discoverableByEmail, setDiscoverableByEmail] = useState(false);
  const [discoverableByName, setDiscoverableByName] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [timezoneGroups, setTimezoneGroups] = useState<{ label: string; items: { value: string; label: string }[] }[]>([]);

  useEffect(() => {
    listTimezones().then((tz) => setTimezoneGroups(groupTimezones(tz))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    const raw = user.raw as Record<string, unknown> | undefined;
    const settings = (raw?.settings as Record<string, unknown> | undefined) ?? {};
    const s = settings as Record<string, unknown>;
    if (s.email_reminders_enabled === false) setEmailRemindersEnabled(false);
    if (s.overdue_tasks_reminders_enabled === false) setOverdueRemindersEnabled(false);
    if (typeof s.overdue_tasks_reminders_time === 'string') setOverdueRemindersTime(s.overdue_tasks_reminders_time as string);
    if (typeof s.week_start === 'number') setWeekStart(s.week_start as number);
    if (typeof s.default_project_id === 'number') setDefaultProjectId((s.default_project_id as number) || null);
    if (typeof s.language === 'string') setLanguage(s.language as string);
    if (typeof s.timezone === 'string') setTimezone(s.timezone as string);
    if (typeof s.discoverable_by_email === 'boolean') setDiscoverableByEmail(s.discoverable_by_email as boolean);
    if (typeof s.discoverable_by_name === 'boolean') setDiscoverableByName(s.discoverable_by_name as boolean);
  }, [user]);

  const clearFeedback = () => setFeedback(null);

  const pushWithSettings = (patch: UserSettingsInput) => {
    return onPushSettings({
      ...patch,
      frontend_settings: frontendSettingsWithCria(undefined),
    });
  };

  const pushWithFeedback = (patch: UserSettingsInput) => {
    pushWithSettings(patch)
      .then(() => { setFeedback({ type: 'success', message: 'Saved' }); setTimeout(clearFeedback, 2000); })
      .catch((e: Error) => { setFeedback({ type: 'error', message: e.message }); setTimeout(clearFeedback, 4000); });
  };

  const handleDateFormatChange = (fmt: string) => {
    setDateFormat(fmt as DateFormat);
  };

  const handleTimeFormatChange = (fmt: string) => {
    setTimeFormat(fmt as TimeFormat);
  };

  const handleWeekStartChange = (v: string) => {
    const n = Number(v);
    setWeekStart(n);
    pushWithSettings({ week_start: n })
      .then(() => notify('user'))
      .then(() => { setFeedback({ type: 'success', message: 'Saved' }); setTimeout(clearFeedback, 2000); })
      .catch((e) => { setFeedback({ type: 'error', message: (e as Error).message }); setTimeout(clearFeedback, 4000); });
  };

  const handleDefaultProjectChange = (v: string) => {
    const n = v === 'none' ? 0 : Number(v);
    setDefaultProjectId(n || null);
    pushWithSettings({ default_project_id: n })
      .then(() => notify('user'))
      .then(() => { setFeedback({ type: 'success', message: 'Saved' }); setTimeout(clearFeedback, 2000); })
      .catch((e) => { setFeedback({ type: 'error', message: (e as Error).message }); setTimeout(clearFeedback, 4000); });
  };

  const handleEmailRemindersToggle = (enabled: boolean) => {
    setEmailRemindersEnabled(enabled);
    pushWithFeedback({ email_reminders_enabled: enabled });
  };

  const handleOverdueRemindersToggle = (enabled: boolean) => {
    setOverdueRemindersEnabled(enabled);
    pushWithFeedback({
      overdue_tasks_reminders_enabled: enabled,
      ...(enabled ? { overdue_tasks_reminders_time: overdueRemindersTime } : {}),
    });
  };

  const handleOverdueRemindersTimeChange = (time: string) => {
    setOverdueRemindersTime(time);
    if (overdueRemindersEnabled) {
      pushWithFeedback({ overdue_tasks_reminders_time: time });
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">General</h3>
      {feedback && (
        <p className={`mb-2 text-xs ${feedback.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
          {feedback.message}
        </p>
      )}
      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
        <div className="flex items-center justify-between">
          <Label>Date Format</Label>
          <Select value={dateFormat} onValueChange={handleDateFormatChange}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
              <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
              <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label>Time Format</Label>
          <Select value={timeFormat} onValueChange={handleTimeFormatChange}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">24-hour</SelectItem>
              <SelectItem value="12h">12-hour</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label>Start week on</Label>
          <Select value={String(weekStart)} onValueChange={handleWeekStartChange}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Sunday</SelectItem>
              <SelectItem value="1">Monday</SelectItem>
              <SelectItem value="2">Tuesday</SelectItem>
              <SelectItem value="3">Wednesday</SelectItem>
              <SelectItem value="4">Thursday</SelectItem>
              <SelectItem value="5">Friday</SelectItem>
              <SelectItem value="6">Saturday</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label>Default project</Label>
          <Select
            value={defaultProjectId ? String(defaultProjectId) : 'none'}
            onValueChange={handleDefaultProjectChange}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Inbox" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Inbox (default)</SelectItem>
              {projects
                .filter((p) => p.serverId != null)
                .map((p) => (
                  <SelectItem key={p.localId} value={String(p.serverId)}>
                    {p.title}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label>Language</Label>
          <Select value={language} onValueChange={(v) => { setLanguage(v); pushWithFeedback({ language: v }); }}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label>Timezone</Label>
          <Select value={timezone} onValueChange={(v) => { setTimezone(v); pushWithFeedback({ timezone: v }); }}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timezoneGroups.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label>Discoverable by email</Label>
          <Switch
            checked={discoverableByEmail}
            onCheckedChange={(v) => { setDiscoverableByEmail(v); pushWithFeedback({ discoverable_by_email: v }); }}
            disabled={disabled}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label>Discoverable by name</Label>
          <Switch
            checked={discoverableByName}
            onCheckedChange={(v) => { setDiscoverableByName(v); pushWithFeedback({ discoverable_by_name: v }); }}
            disabled={disabled}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label>Email reminders</Label>
          <Switch
            checked={emailRemindersEnabled}
            onCheckedChange={handleEmailRemindersToggle}
            disabled={disabled}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label>Overdue reminder email</Label>
          <Switch
            checked={overdueRemindersEnabled}
            onCheckedChange={handleOverdueRemindersToggle}
            disabled={disabled}
          />
        </div>
        {overdueRemindersEnabled && (
          <div className="flex items-center justify-between">
            <Label>Overdue reminder time</Label>
            <input
              type="time"
              value={overdueRemindersTime}
              onChange={(e) => handleOverdueRemindersTimeChange(e.target.value)}
              disabled={disabled}
              className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)] disabled:opacity-50"
            />
          </div>
        )}
      </div>
    </section>
  );
}
