import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, getAuthSnapshot } from '@/auth/store';
import { probeServer, refreshSession } from '@/api/client';
import { useOnline } from '@/hooks/useOnline';
import { isMobilePlatform } from '@/lib/platform';
import { onVisibilityChange, isPageVisible } from '@/lib/visibility';
import { liveTransportAvailable, tauriTransport } from '@/tauri/websocket';
import { refetchTaskByServerId } from './pull';
import { reconcileDeletions } from './reconcile';
import { isSyncCycleRunning, lastSyncCycleAt, runSyncCycle } from './syncCycle';
import {
  createLiveHandlers,
  liveUrl,
  looksLikeJwt,
  startLiveSync,
  stopLiveSync,
  supportsLiveSync,
} from './liveSync';

/** A cycle that finished this recently makes a post-connect catch-up redundant. */
const RECENT_CYCLE_MS = 20_000;

/**
 * Optional live sync (see liveSync.ts for what Vikunja's socket does and
 * doesn't push). Runs only inside the Tauri webview, for password sessions
 * (the socket takes a user JWT: API tokens and link shares are refused), while
 * online and against a server not known to predate the endpoint. Every other
 * case is a no-op and the 60s poll carries on exactly as before. Mount once.
 */
export function useLiveSync() {
  const qc = useQueryClient();
  const online = useOnline();
  const serverUrl = useAuth((s) =>
    s.status.kind === 'authenticated' ? s.status.credentials.serverUrl : null,
  );
  const eligible = useAuth(
    (s) =>
      s.status.kind === 'authenticated' &&
      s.status.credentials.authMethod === 'password' &&
      looksLikeJwt(s.status.credentials.token),
  );

  useEffect(() => {
    if (!eligible || !online || !serverUrl || !liveTransportAvailable()) return;

    let cancelled = false;
    let teardown = () => {};

    const begin = () => {
      const mobile = isMobilePlatform();
      const handlers = createLiveHandlers({
        actions: {
          refreshTask: (id) => refetchTaskByServerId(id),
          runCycle: () => runSyncCycle(),
          reconcile: async () => {
            await reconcileDeletions();
          },
        },
        refreshNotifications: () => {
          void qc.invalidateQueries({ queryKey: ['notifications'] });
        },
        recentlySynced: () =>
          isSyncCycleRunning() || Date.now() - lastSyncCycleAt() < RECENT_CYCLE_MS,
      });
      const client = startLiveSync({
        transport: tauriTransport,
        url: () => liveUrl(getAuthSnapshot().serverUrl),
        token: () => getAuthSnapshot().token,
        refresh: refreshSession,
        isVisible: isPageVisible,
        pauseWhenHidden: mobile,
        onNotification: handlers.onNotification,
        onResync: handlers.onResync,
      });
      const stopAuth = useAuth.subscribe((state, prev) => {
        const token = (s: typeof state) =>
          s.status.kind === 'authenticated' ? s.status.credentials.token : null;
        if (token(state) !== token(prev)) client.tokenChanged();
      });
      // iOS suspends sockets in the background: close on hide, reconnect on show.
      const stopVisibility = mobile
        ? onVisibilityChange({
            onShow: () => client.visibilityChanged(),
            onHide: () => client.visibilityChanged(),
          })
        : () => {};
      teardown = () => {
        stopAuth();
        stopVisibility();
        handlers.cancel();
        stopLiveSync();
      };
    };

    // A version known to predate /ws (< 2.3.0) never connects. A failed probe
    // means "unknown", which still tries: the attempt is cheap and backs off.
    void probeServer(serverUrl)
      .then(({ version }) => version)
      .catch(() => null)
      .then((version) => {
        if (!cancelled && supportsLiveSync(version)) begin();
      });

    return () => {
      cancelled = true;
      teardown();
    };
  }, [eligible, online, serverUrl, qc]);
}
