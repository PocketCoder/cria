/**
 * WebSocket transport for live sync, over `@tauri-apps/plugin-websocket`.
 *
 * Why not the webview's own `WebSocket`: it would send `Origin:
 * tauri://localhost` (or `http://tauri.localhost`), which Vikunja's upgrade
 * handler checks against `cors.origins` (default: localhost and the server's
 * public URL) and answers with 403, and the release CSP's `connect-src` would
 * block an arbitrary user-configured server anyway. The plugin opens the
 * socket from Rust, sends no Origin, and reports back over IPC.
 *
 * Lives in src/tauri/ so the plugin's API churn stays behind a stable shape.
 * Only present inside the Tauri webview; the browser dev server and the test
 * runner have no plugin, so `liveTransportAvailable()` is false there.
 */

import type { LiveSocket, LiveTransport, TransportEvent } from '@/sync/liveSync';

const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function liveTransportAvailable(): boolean {
  return isTauri;
}

/** The plugin's `Message`, or a bare string when the stream itself errors. */
type PluginMessage =
  | string
  | { type: 'Text'; data: string }
  | { type: 'Binary' | 'Ping' | 'Pong'; data: number[] }
  | { type: 'Close'; data: { code: number; reason: string } | null };

/** Map a plugin message onto the transport's vocabulary. Exported for tests. */
export function toTransportEvent(message: PluginMessage): TransportEvent {
  if (typeof message === 'string') return { type: 'error', message };
  switch (message.type) {
    case 'Text':
      return { type: 'text', data: message.data };
    case 'Close':
      return { type: 'close', code: message.data?.code, reason: message.data?.reason };
    default:
      return { type: 'activity' };
  }
}

export const tauriTransport: LiveTransport = {
  async connect(url, onEvent) {
    const { default: PluginWebSocket } = await import('@tauri-apps/plugin-websocket');
    const ws = await PluginWebSocket.connect(url);
    // The server sends nothing until we authenticate, so no frame can arrive
    // before this listener is attached.
    ws.addListener((message) => onEvent(toTransportEvent(message as PluginMessage)));
    const socket: LiveSocket = {
      send: (text) => ws.send(text),
      close: () => ws.disconnect(),
    };
    return socket;
  },
};
