import { useEffect } from 'react';
import { useAuth } from '@/auth/store';
import { LoginScreen } from '@/features/login/LoginScreen';
import { Shell } from '@/features/shell/Shell';
import { ThemeProvider } from '@/components/ThemeProvider';
import { usePeriodicSync } from '@/sync/usePeriodicSync';
import { useReminderScheduler } from '@/sync/useReminderScheduler';
import { useSummaryNotifications } from '@/sync/useSummaryNotifications';
import { startSettingsSync } from '@/sync/settingsSync';
import { scheduleBlobSweep } from '@/sync/blobSweep';
import { useDockBadge } from '@/queries/badge';

export function App() {
  const status = useAuth((s) => s.status);
  const hydrate = useAuth((s) => s.hydrate);

  useEffect(() => {
    if (status.kind === 'unknown') {
      void hydrate();
    }
  }, [status.kind, hydrate]);

  // Push display-pref changes (theme/date-format/…) to the server's
  // frontend_settings so they survive an iOS localStorage eviction and sync
  // across devices. Hydration on load happens in useCurrentUser.
  useEffect(() => startSettingsSync(), []);

  // Once per launch, after a delay: delete queued-upload bytes nothing
  // refers to any more. Local only, so it doesn't wait for sign-in.
  useEffect(() => scheduleBlobSweep(), []);

  usePeriodicSync();
  useReminderScheduler();
  useSummaryNotifications();
  useDockBadge();

  let body: React.ReactNode;
  if (status.kind === 'unknown') {
    body = (
      <div className="flex min-h-full items-center justify-center p-6 text-sm text-[var(--color-muted-foreground)]">
        Starting up…
      </div>
    );
  } else if (status.kind === 'authenticated') {
    body = <Shell />;
  } else {
    body = <LoginScreen />;
  }

  return (
    <ThemeProvider>
      {body}
    </ThemeProvider>
  );
}
