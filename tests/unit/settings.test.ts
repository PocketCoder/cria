// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useSettings } from '@/stores/settings';

describe('useSettings', () => {
  beforeEach(() => {
    useSettings.setState({
      notificationsEnabled: true,
      colorScheme: 'system',
      dateFormat: 'YYYY-MM-DD',
      timeFormat: '24h',
      trayIconEnabled: true,
      closeToTray: true,
      hideDockOnTray: false,
      playSoundWhenDone: false,
      quickAddMagicMode: 'vikunja',
    });
  });

  it('has correct defaults', () => {
    const s = useSettings.getState();
    expect(s.notificationsEnabled).toBe(true);
    expect(s.colorScheme).toBe('system');
    expect(s.dateFormat).toBe('YYYY-MM-DD');
    expect(s.timeFormat).toBe('24h');
    expect(s.trayIconEnabled).toBe(true);
    expect(s.closeToTray).toBe(true);
    expect(s.hideDockOnTray).toBe(false);
    expect(s.playSoundWhenDone).toBe(false);
  });

  it('setNotificationsEnabled toggles', () => {
    useSettings.getState().setNotificationsEnabled(false);
    expect(useSettings.getState().notificationsEnabled).toBe(false);
    useSettings.getState().setNotificationsEnabled(true);
    expect(useSettings.getState().notificationsEnabled).toBe(true);
  });

  it('setColorScheme cycles schemes', () => {
    useSettings.getState().setColorScheme('dark');
    expect(useSettings.getState().colorScheme).toBe('dark');
    useSettings.getState().setColorScheme('light');
    expect(useSettings.getState().colorScheme).toBe('light');
    useSettings.getState().setColorScheme('system');
    expect(useSettings.getState().colorScheme).toBe('system');
  });

  it('setDateFormat changes format', () => {
    useSettings.getState().setDateFormat('MM/DD/YYYY');
    expect(useSettings.getState().dateFormat).toBe('MM/DD/YYYY');
    useSettings.getState().setDateFormat('DD/MM/YYYY');
    expect(useSettings.getState().dateFormat).toBe('DD/MM/YYYY');
  });

  it('setTimeFormat toggles', () => {
    useSettings.getState().setTimeFormat('12h');
    expect(useSettings.getState().timeFormat).toBe('12h');
    useSettings.getState().setTimeFormat('24h');
    expect(useSettings.getState().timeFormat).toBe('24h');
  });

  it('setTrayIconEnabled toggles', () => {
    useSettings.getState().setTrayIconEnabled(false);
    expect(useSettings.getState().trayIconEnabled).toBe(false);
  });

  it('setCloseToTray toggles', () => {
    useSettings.getState().setCloseToTray(false);
    expect(useSettings.getState().closeToTray).toBe(false);
  });

  it('setHideDockOnTray toggles', () => {
    useSettings.getState().setHideDockOnTray(true);
    expect(useSettings.getState().hideDockOnTray).toBe(true);
  });

  it('setPlaySoundWhenDone toggles', () => {
    useSettings.getState().setPlaySoundWhenDone(true);
    expect(useSettings.getState().playSoundWhenDone).toBe(true);
  });

  // The field was added without bumping `cria:settings/v2`: a store saved
  // before it existed must rehydrate with the default, not undefined.
  it('rehydrates an older persisted store with the default quick add mode', async () => {
    localStorage.setItem('cria:settings/v2', JSON.stringify({ state: { colorScheme: 'dark' }, version: 0 }));
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().colorScheme).toBe('dark');
    expect(useSettings.getState().quickAddMagicMode).toBe('vikunja');
  });

  it('setQuickAddMagicMode switches modes', () => {
    for (const mode of ['todoist', 'disabled', 'vikunja'] as const) {
      useSettings.getState().setQuickAddMagicMode(mode);
      expect(useSettings.getState().quickAddMagicMode).toBe(mode);
    }
  });
});
