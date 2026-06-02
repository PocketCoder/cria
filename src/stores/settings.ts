import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ColorScheme = 'light' | 'dark' | 'system';
export type DateFormat = 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';

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
    }),
    { name: 'cria:settings/v2' },
  ),
);
