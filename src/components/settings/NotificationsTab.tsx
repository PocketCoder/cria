import { useState, useEffect } from 'react';
import { useSettings } from '@/stores/settings';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ExternalLink } from 'lucide-react';
import { isPermissionGranted, requestPermission } from '@/tauri/notification';
import { openNotificationSettings } from '@/utils/notify';

interface Props {
  disabled?: boolean;
}

function SummaryRow({
  label,
  hint,
  enabled,
  time,
  disabled,
  onEnabled,
  onTime,
}: {
  label: string;
  hint?: string;
  enabled: boolean;
  time: string;
  disabled?: boolean;
  onEnabled: (v: boolean) => void;
  onTime: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Switch checked={enabled} disabled={disabled} onCheckedChange={onEnabled} />
      </div>
      {enabled ? (
        <div className="flex items-center justify-between">
          <Label>{label} time</Label>
          <input
            aria-label={`${label} time`}
            type="time"
            value={time}
            onChange={(e) => e.target.value && onTime(e.target.value)}
            disabled={disabled}
            className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)] disabled:opacity-50"
          />
        </div>
      ) : null}
      {hint ? <p className="text-xs text-[var(--color-muted-foreground)]">{hint}</p> : null}
    </div>
  );
}

export function NotificationsTab({ disabled }: Props) {
  const notificationsEnabled = useSettings((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettings((s) => s.setNotificationsEnabled);
  const morningEnabled = useSettings((s) => s.morningSummaryEnabled);
  const setMorningEnabled = useSettings((s) => s.setMorningSummaryEnabled);
  const morningTime = useSettings((s) => s.morningSummaryTime);
  const setMorningTime = useSettings((s) => s.setMorningSummaryTime);
  const weeklyEnabled = useSettings((s) => s.weeklyRoundupEnabled);
  const setWeeklyEnabled = useSettings((s) => s.setWeeklyRoundupEnabled);
  const weeklyTime = useSettings((s) => s.weeklyRoundupTime);
  const setWeeklyTime = useSettings((s) => s.setWeeklyRoundupTime);
  const [osPermissionGranted, setOsPermissionGranted] = useState<boolean | null>(null);

  useEffect(() => {
    isPermissionGranted().then(setOsPermissionGranted).catch(() => setOsPermissionGranted(false));
  }, []);

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Notifications</h3>
      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
        <div className="flex items-center justify-between">
          <Label>Show desktop notifications</Label>
          <Switch
            checked={notificationsEnabled}
            disabled={disabled}
            onCheckedChange={async (enabled) => {
              if (!enabled) {
                setNotificationsEnabled(false);
                return;
              }
              const granted =
                osPermissionGranted ?? (await requestPermission()) === 'granted';
              setOsPermissionGranted(granted);
              setNotificationsEnabled(granted);
            }}
          />
        </div>
        <SummaryRow
          label="Morning summary"
          enabled={morningEnabled}
          time={morningTime}
          disabled={disabled || !notificationsEnabled}
          onEnabled={setMorningEnabled}
          onTime={setMorningTime}
        />
        <SummaryRow
          label="Weekly round-up"
          hint="Arrives on the first day of your week (General → Start week on)."
          enabled={weeklyEnabled}
          time={weeklyTime}
          disabled={disabled || !notificationsEnabled}
          onEnabled={setWeeklyEnabled}
          onTime={setWeeklyTime}
        />
        {osPermissionGranted === false && notificationsEnabled && (
          <p className="text-xs text-[var(--color-warning-text)]">
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
  );
}
