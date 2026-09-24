// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveBlob } from '@/lib/download';

beforeEach(() => {
  document.body.innerHTML = '';
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

describe('saveBlob', () => {
  it('creates an anchor, clicks it, and cleans up', () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const click = vi.fn();
    const remove = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
    vi.spyOn(HTMLAnchorElement.prototype, 'remove').mockImplementation(remove);
    const appendChild = vi.spyOn(document.body, 'appendChild');

    saveBlob(blob, 'test.txt');

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    const anchor = appendChild.mock.calls[0]?.[0] as HTMLAnchorElement | undefined;
    expect(anchor).toBeTruthy();
    expect(anchor!.download).toBe('test.txt');
    expect(anchor!.href).toBe('blob:mock');
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
