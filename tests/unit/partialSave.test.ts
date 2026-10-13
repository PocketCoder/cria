import { describe, expect, it } from 'vitest';
import { partialSaveMessage } from '@/lib/partialSave';

describe('partialSaveMessage', () => {
  it('stays generic when nothing was saved', () => {
    expect(partialSaveMessage(0, 3)).toBe('Some tasks could not be created. Please try again.');
  });
  it('says how many landed', () => {
    expect(partialSaveMessage(2, 5)).toBe('Created 2 of 5 tasks. Please try again for the rest.');
    expect(partialSaveMessage(1, 1)).toBe('Created 1 of 1 task. Please try again for the rest.');
  });
});
