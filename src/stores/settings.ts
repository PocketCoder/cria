import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ColorScheme = 'light' | 'dark' | 'system';
export type DateFormat = 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';
export type TimeFormat = '12h' | '24h';
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface SettingsState {
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  language: string;
  setLanguage: (lang: string) => void;
  timezone: string;
  setTimezone: (tz: string) => void;
  dateFormat: DateFormat;
  setDateFormat: (fmt: DateFormat) => void;
  timeFormat: TimeFormat;
  setTimeFormat: (fmt: TimeFormat) => void;
  weekStart: WeekStart;
  setWeekStart: (day: WeekStart) => void;
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
      language: 'en',
      setLanguage: (lang) => set({ language: lang }),
      timezone: 'UTC',
      setTimezone: (tz) => set({ timezone: tz }),
      dateFormat: 'YYYY-MM-DD',
      setDateFormat: (fmt) => set({ dateFormat: fmt }),
      timeFormat: '24h',
      setTimeFormat: (fmt) => set({ timeFormat: fmt }),
      weekStart: 0,
      setWeekStart: (day) => set({ weekStart: day }),
      trayIconEnabled: true,
      setTrayIconEnabled: (enabled) => set({ trayIconEnabled: enabled }),
      playSoundWhenDone: false,
      setPlaySoundWhenDone: (enabled) => set({ playSoundWhenDone: enabled }),
    }),
    { name: 'cria:settings/v2' },
  ),
);
