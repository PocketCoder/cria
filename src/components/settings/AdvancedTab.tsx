import { useState, useEffect } from 'react';
import { useSettings } from '@/stores/settings';
import { useServerVersion } from '@/queries/server';
import { useUpdaterStore } from '@/stores/updater';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import { isMobilePlatform } from '@/lib/platform';
import { isEnabled, enable, disable } from '@/tauri/autostart';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import pkg from '../../../package.json';

export function AdvancedTab() {
  const isDesktop = !isMobilePlatform();
  const { data: serverVersion } = useServerVersion();
  const updaterState = useUpdaterStore((s) => s.state);
  const runUpdaterCheck = useUpdaterStore((s) => s.runCheck);

  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const trayIconEnabled = useSettings((s) => s.trayIconEnabled);
  const setTrayIconEnabledInStore = useSettings((s) => s.setTrayIconEnabled);
  const closeToTray = useSettings((s) => s.closeToTray);
  const setCloseToTrayInStore = useSettings((s) => s.setCloseToTray);
  const hideDockOnTray = useSettings((s) => s.hideDockOnTray);
  const setHideDockOnTrayInStore = useSettings((s) => s.setHideDockOnTray);

  useEffect(() => {
    isEnabled().then(setAutostartEnabled).catch(() => setAutostartEnabled(false));
  }, []);

  const handleAutostartToggle = async () => {
    try {
      const enabled = await isEnabled();
      if (enabled) {
        await disable();
      } else {
        await enable();
      }
      setAutostartEnabled(!(await isEnabled()));
    } catch (e) {
      console.error('Autostart toggle failed', e);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Advanced</h3>
      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
        {isDesktop && (
          <>
            <div className="flex items-center justify-between">
              <Label>Launch at login</Label>
              <Switch checked={autostartEnabled} onCheckedChange={handleAutostartToggle} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Show tray icon</Label>
              <Switch
                checked={trayIconEnabled}
                onCheckedChange={(newVal) => {
                  setTrayIconEnabledInStore(newVal);
                  void invoke('set_tray_visible', { visible: newVal });
                }}
              />
            </div>
            {trayIconEnabled && (
              <>
                <div className="flex items-center justify-between">
                  <Label>Close to tray</Label>
                  <Switch
                    checked={closeToTray}
                    onCheckedChange={(newVal) => {
                      setCloseToTrayInStore(newVal);
                      void invoke('set_close_to_tray', { enabled: newVal });
                    }}
                  />
                </div>
                {closeToTray && (
                  <div className="flex items-center justify-between">
                    <Label>Hide dock icon when closed</Label>
                    <Switch
                      checked={hideDockOnTray}
                      onCheckedChange={(newVal) => {
                        setHideDockOnTrayInStore(newVal);
                        void invoke('set_hide_dock_on_tray', { enabled: newVal });
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
        <div className="flex items-center justify-between">
          <Label>CalDAV Documentation</Label>
          <button
            type="button"
            onClick={() => void openUrl('https://vikunja.io/help/caldav/')}
            className="flex items-center gap-1 text-xs text-[var(--color-primary)] underline"
          >
            Open <ExternalLink className="h-3 w-3" />
          </button>
        </div>
        {isDesktop && (
          <div className="flex items-center justify-between">
            <Label>Updates</Label>
            <div className="flex items-center gap-2">
              {updaterState.kind === 'checking' && (
                <span className="text-xs text-[var(--color-muted-foreground)]">Checking…</span>
              )}
              {updaterState.kind === 'available' && (
                <span className="text-xs text-green-500">Update available!</span>
              )}
              {updaterState.kind === 'error' && (
                <span className="text-xs text-red-500">Check failed</span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runUpdaterCheck()}
                disabled={updaterState.kind === 'checking'}
              >
                Check for Updates
              </Button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)]">
          <span>Version</span>
          <span>
            Cria {pkg.version}
            {serverVersion ? <span className="ml-2">· Server {serverVersion}</span> : null}
          </span>
        </div>
      </div>
    </section>
  );
}
