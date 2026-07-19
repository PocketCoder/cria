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

export function NotificationsTab({ disabled }: Props) {
  const notificationsEnabled = useSettings((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettings((s) => s.setNotificationsEnabled);
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
  );
}
