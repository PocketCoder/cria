import { useEffect } from 'react';
import { useAuth } from '@/auth/store';
import { LoginScreen } from '@/features/login/LoginScreen';
import { Shell } from '@/features/shell/Shell';
import { ThemeProvider } from '@/components/ThemeProvider';
import { usePeriodicSync } from '@/sync/usePeriodicSync';
import { useReminderScheduler } from '@/sync/useReminderScheduler';
import { useDockBadge } from '@/queries/badge';

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
