import { useEffect } from 'react';
import { useAuth } from '@/auth/store';
import { LoginScreen } from '@/features/login/LoginScreen';
import { LandingScreen } from '@/features/login/LandingScreen';

export function App() {
  const status = useAuth((s) => s.status);
  const hydrate = useAuth((s) => s.hydrate);

  useEffect(() => {
    if (status.kind === 'unknown') {
      void hydrate();
    }
  }, [status.kind, hydrate]);

  if (status.kind === 'unknown') {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-sm text-[var(--color-muted-foreground)]">
        Starting up…
      </div>
    );
  }

  return status.kind === 'authenticated' ? <LandingScreen /> : <LoginScreen />;
}
