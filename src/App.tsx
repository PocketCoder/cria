import { useEffect } from 'react';
import { useAuth } from '@/auth/store';
import { LoginScreen } from '@/features/login/LoginScreen';
import { Shell } from '@/features/shell/Shell';
import { ThemeProvider } from '@/components/ThemeProvider';
import { usePeriodicSync } from '@/sync/usePeriodicSync';
import { useReminderScheduler } from '@/sync/useReminderScheduler';
import { useDockBadge } from '@/queries/badge';
import { useUpdater } from '@/queries/updater';
import { UpdateBanner } from '@/features/shell/UpdateBanner';

export function App() {
  const status = useAuth((s) => s.status);
  const hydrate = useAuth((s) => s.hydrate);

  useEffect(() => {
    if (status.kind === 'unknown') {
      hydrate();
    }
  }, [status.kind, hydrate]);

  usePeriodicSync();
  useReminderScheduler();
  useDockBadge();

  // **Mounted at App level**, not inside Shell, so the banner is visible
  // even on the LoginScreen. Otherwise a release that ships with broken
  // sign-in (e.g. v0.2.0-alpha's CORS bug) leaves users stranded with no
  // way to receive the fix — they can't log in, so Shell never renders,
  // so useUpdater never runs.
  const updater = useUpdater();

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
      {/* Fixed top strip — only renders content when updater has an
          available / installing update, so it stays out of the way the
          rest of the time. */}
      <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center">
        <div className="pointer-events-auto">
          <UpdateBanner
            state={updater.state}
            onInstall={() => void updater.install()}
          />
        </div>
      </div>
      {body}
    </ThemeProvider>
  );
}
