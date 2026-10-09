import { describe, it, expect, vi, beforeEach } from 'vitest';

type Listener = (m: unknown) => void;
const plugin = vi.hoisted(() => {
  const state: { listener: Listener | null; send: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } = {
    listener: null,
    send: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
  const connect = vi.fn(async (_url: string) => ({
    addListener: (cb: Listener) => {
      state.listener = cb;
      return () => {};
    },
    send: state.send,
    disconnect: state.disconnect,
  }));
  return { state, connect };
});
vi.mock('@tauri-apps/plugin-websocket', () => ({ default: { connect: plugin.connect } }));

import { liveTransportAvailable, tauriTransport, toTransportEvent } from '@/tauri/websocket';

beforeEach(() => {
  plugin.state.listener = null;
  plugin.connect.mockClear();
  plugin.state.send.mockClear();
  plugin.state.disconnect.mockClear();
});

describe('toTransportEvent', () => {
  it('maps text frames', () => {
    expect(toTransportEvent({ type: 'Text', data: '{"a":1}' })).toEqual({ type: 'text', data: '{"a":1}' });
  });
  it('maps close frames, with or without a payload', () => {
    expect(toTransportEvent({ type: 'Close', data: { code: 1008, reason: 'token expired' } })).toEqual({
      type: 'close',
      code: 1008,
      reason: 'token expired',
    });
    expect(toTransportEvent({ type: 'Close', data: null })).toEqual({
      type: 'close',
      code: undefined,
      reason: undefined,
    });
  });
  it('maps pings, pongs and binary to plain activity', () => {
    for (const type of ['Ping', 'Pong', 'Binary'] as const) {
      expect(toTransportEvent({ type, data: [1] })).toEqual({ type: 'activity' });
    }
  });
  it('maps the bare string the plugin sends for a stream error', () => {
    expect(toTransportEvent('IO error: connection reset')).toEqual({
      type: 'error',
      message: 'IO error: connection reset',
    });
  });
});

describe('tauriTransport', () => {
  it('is not available outside the Tauri webview', () => {
    expect(liveTransportAvailable()).toBe(false);
  });

  it('connects through the plugin and forwards frames as transport events', async () => {
    const onEvent = vi.fn();
    await tauriTransport.connect('wss://vk.test/api/v1/ws', onEvent);
    expect(plugin.connect).toHaveBeenCalledWith('wss://vk.test/api/v1/ws');
    plugin.state.listener!({ type: 'Text', data: 'hi' });
    plugin.state.listener!({ type: 'Ping', data: [] });
    expect(onEvent.mock.calls).toEqual([[{ type: 'text', data: 'hi' }], [{ type: 'activity' }]]);
  });

  it('sends text and closes with a normal close frame', async () => {
    const socket = await tauriTransport.connect('wss://vk.test/api/v1/ws', () => {});
    await socket.send('hello');
    expect(plugin.state.send).toHaveBeenCalledWith('hello');
    await socket.close();
    expect(plugin.state.disconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects when the plugin cannot connect', async () => {
    plugin.connect.mockRejectedValueOnce(new Error('HTTP error: 404 Not Found'));
    await expect(tauriTransport.connect('wss://vk.test/api/v1/ws', () => {})).rejects.toThrow('404');
  });
});
