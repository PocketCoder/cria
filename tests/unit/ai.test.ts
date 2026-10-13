import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const sendNotification = vi.hoisted(() => vi.fn());
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/tauri/notification', () => ({ sendNotification }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => mobile.value }));

import { generate, aiAvailability } from '@/tauri/ai';

const focus = (hasFocus: boolean) => vi.stubGlobal('document', { hasFocus: () => hasFocus });

const args = { title: 'Organising your ramble', instructions: 'i', prompt: 'p' };

beforeEach(() => {
  vi.clearAllMocks();
  mobile.value = false;
});

describe('tauri/ai generate', () => {
  it('returns the model text and stays quiet while focused', async () => {
    focus(true);
    invoke.mockResolvedValue('Hi.');
    expect(await generate(args)).toBe('Hi.');
    expect(invoke).toHaveBeenCalledWith('ai_generate', args);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('notifies on desktop when the window is unfocused', async () => {
    focus(false);
    invoke.mockResolvedValue('Hi.');
    await generate(args);
    expect(sendNotification).toHaveBeenCalledWith({ title: args.title, body: 'Ready to review.' });
  });

  it('notifies the error and rethrows', async () => {
    focus(false);
    invoke.mockRejectedValue('unavailable: appleIntelligenceNotEnabled');
    await expect(generate(args)).rejects.toBe('unavailable: appleIntelligenceNotEnabled');
    expect(sendNotification).toHaveBeenCalledWith({
      title: args.title,
      body: 'Failed: unavailable: appleIntelligenceNotEnabled',
    });
  });

  it('reports availability, and unsupportedOS when the command is missing', async () => {
    invoke.mockResolvedValue('available');
    expect(await aiAvailability()).toBe('available');
    invoke.mockRejectedValue(new Error('not in tauri'));
    expect(await aiAvailability()).toBe('unsupportedOS');
  });

  it('leaves notifying to native code on mobile', async () => {
    mobile.value = true;
    focus(false);
    invoke.mockResolvedValue('Hi.');
    await generate(args);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
