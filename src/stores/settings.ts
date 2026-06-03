import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ColorScheme = 'light' | 'dark' | 'system';
export type DateFormat = 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';
export type TimeFormat = '12h' | '24h';

// NOTE: language, timezone and week-start preferences were removed from the
// settings pane — they synced to the server but had no local effect, so the
// controls misled users. They live as GitHub issues until they're wired into
// local rendering (timezone, week start) or i18n (language). The server values
// still round-trip untouched via SettingsModal's settingsRef snapshot.
interface SettingsState {
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  dateFormat: DateFormat;
  setDateFormat: (fmt: DateFormat) => void;
  timeFormat: TimeFormat;
  setTimeFormat: (fmt: TimeFormat) => void;
  trayIconEnabled: boolean;
  setTrayIconEnabled: (enabled: boolean) => void;
  playSoundWhenDone: boolean;
  setPlaySoundWhenDone: (enabled: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      notificationsEnabled: true,
      setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),
      colorScheme: 'system',
      setColorScheme: (scheme) => set({ colorScheme: scheme }),
      dateFormat: 'YYYY-MM-DD',
      setDateFormat: (fmt) => set({ dateFormat: fmt }),
      timeFormat: '24h',
      setTimeFormat: (fmt) => set({ timeFormat: fmt }),
      trayIconEnabled: true,
      setTrayIconEnabled: (enabled) => set({ trayIconEnabled: enabled }),
      playSoundWhenDone: false,
      setPlaySoundWhenDone: (enabled) => set({ playSoundWhenDone: enabled }),
    }),
    { name: 'cria:settings/v2' },
  ),
);
