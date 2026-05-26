import { useCallback, useEffect, useState } from 'react';
import {
  checkForUpdate,
  installUpdate,
  type AvailableUpdate,
} from '@/tauri/updater';

/**
 * Update state machine. Lives at the App level — one instance only,
 * mounted from `Shell` so the banner can render from the footer.
 *
 * States:
 * - `idle`         — never checked / no update
 * - `checking`     — initial network call in flight
 * - `available`    — update found, banner visible, awaiting user click
 * - `installing`   — download + install in flight after user click
 * - `error`        — last check or install failed; banner stays hidden
 *
 * The startup check is silent: failures (no network, no manifest yet,
 * dev mode) log a warning and leave state at `idle`. Only a *successful*
 * check that finds a newer version surfaces UI.
 */
export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; update: AvailableUpdate }
  | { kind: 'installing'; update: AvailableUpdate }
  | { kind: 'error'; message: string };

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({ kind: 'idle' });

  const runCheck = useCallback(async () => {
    setState({ kind: 'checking' });
    try {
      const update = await checkForUpdate();
      if (update) {
        setState({ kind: 'available', update });
      } else {
        setState({ kind: 'idle' });
      }
    } catch (err) {
      console.warn('[updater] check failed:', err);
      setState({ kind: 'idle' });
    }
  }, []);

  const install = useCallback(async () => {
    if (state.kind !== 'available') return;
    const { update } = state;
    setState({ kind: 'installing', update });
    try {
      await installUpdate(update);
      // After installUpdate the app relaunches; this code path is
      // effectively unreachable. Left here in case relaunch fails.
    } catch (err) {
      console.error('[updater] install failed:', err);
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [state]);

  // One check on mount. Subsequent checks can be triggered manually
  // (e.g., from a "Check for updates" settings button).
  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  return { state, runCheck, install };
}
