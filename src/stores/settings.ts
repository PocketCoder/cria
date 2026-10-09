import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_QUICK_ADD_MAGIC_MODE, type QuickAddMagicMode } from '@/lib/quickAddPrefixes';

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
  closeToTray: boolean;
  setCloseToTray: (enabled: boolean) => void;
  hideDockOnTray: boolean;
  setHideDockOnTray: (enabled: boolean) => void;
  playSoundWhenDone: boolean;
  setPlaySoundWhenDone: (enabled: boolean) => void;
  // Quick Add Magic prefix mode. Mirrors the user's Vikunja-web setting
  // (`frontend_settings.quick_add_magic_mode`), synced in src/sync/settingsSync.
  quickAddMagicMode: QuickAddMagicMode;
  setQuickAddMagicMode: (mode: QuickAddMagicMode) => void;
  // Defaults for the photo → tasks importer (overridable per-import in the
  // capture modal). `shoppingProjectId` null means "ask each time"; an empty
  // `shoppingLabel` means don't tag. See src/features/shoppingPhoto.
  shoppingProjectId: string | null;
  setShoppingProjectId: (id: string | null) => void;
  shoppingLabel: string;
  setShoppingLabel: (label: string) => void;
  // Servers signed in to before, most recent first, for the login screen's
  // quick-pick chips. Non-secret: the token stays in the keychain. `username`
  // is only set when the user ticked "Remember me".
  recentServers: RecentServer[];
  rememberServer: (url: string, username?: string) => void;
  forgetServer: (url: string) => void;
}

export interface RecentServer {
  url: string;
  username?: string;
}

export const MAX_RECENT_SERVERS = 5;

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
      closeToTray: true,
      setCloseToTray: (enabled) => set({ closeToTray: enabled }),
      hideDockOnTray: false,
      setHideDockOnTray: (enabled) => set({ hideDockOnTray: enabled }),
      playSoundWhenDone: false,
      setPlaySoundWhenDone: (enabled) => set({ playSoundWhenDone: enabled }),
      quickAddMagicMode: DEFAULT_QUICK_ADD_MAGIC_MODE,
      setQuickAddMagicMode: (mode) => set({ quickAddMagicMode: mode }),
      shoppingProjectId: null,
      setShoppingProjectId: (id) => set({ shoppingProjectId: id }),
      shoppingLabel: 'shopping',
      setShoppingLabel: (label) => set({ shoppingLabel: label }),
      recentServers: [],
      rememberServer: (url, username) =>
        set((s) => ({
          recentServers: [
            { url, ...(username ? { username } : {}) },
            ...s.recentServers.filter((r) => r.url !== url),
          ].slice(0, MAX_RECENT_SERVERS),
        })),
      forgetServer: (url) =>
        set((s) => ({ recentServers: s.recentServers.filter((r) => r.url !== url) })),
    }),
    { name: 'cria:settings/v2' },
  ),
);
