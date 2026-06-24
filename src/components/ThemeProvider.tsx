import { useEffect, type ReactNode } from 'react';
import { useSettings, type ColorScheme } from '@/stores/settings';
import { refreshNativeGlassTint } from '@/tauri/liquidGlass';

function applyTheme(scheme: ColorScheme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (scheme === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.add(isDark ? 'dark' : 'light');
  } else {
    root.classList.add(scheme);
  }
  // Keep the native macOS glass tint in sync with the active scheme (no-op
  // off macOS / when glass was never applied).
  void refreshNativeGlassTint();
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const colorScheme = useSettings((s) => s.colorScheme);

  useEffect(() => {
    applyTheme(colorScheme);

    if (colorScheme !== 'system') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [colorScheme]);

  return <>{children}</>;
}
