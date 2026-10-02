import { describe, expect, it, vi } from 'vitest';
import {
  imageFilesFromClipboard,
  imageFilesFromDrop,
  imageUploadMessage,
  isEmptyDescription,
  looksEmptyHtml,
  matchSlashQuery,
  slashKeyAction,
  stepSlashIndex,
} from '@/features/task-detail/editorLogic';
import {
  COMMANDS,
  filterCommands,
  setImagePickerTrigger,
} from '@/features/task-detail/editorCommands';

describe('empty detection', () => {
  it('treats tag-only descriptions as empty', () => {
    expect(isEmptyDescription(null)).toBe(true);
    expect(isEmptyDescription('')).toBe(true);
    expect(isEmptyDescription('<p> </p>')).toBe(true);
    expect(isEmptyDescription('<p>hi</p>')).toBe(false);
  });
  it('keeps media-only content on save', () => {
    expect(looksEmptyHtml('<p></p>')).toBe(true);
    expect(looksEmptyHtml('<p>text</p>')).toBe(false);
    expect(looksEmptyHtml('<p><img src="x"></p>')).toBe(false);
    expect(looksEmptyHtml('<hr>')).toBe(false);
    expect(looksEmptyHtml('<ul data-type="taskList"><li><input type="checkbox"></li></ul>')).toBe(false);
  });
});

describe('matchSlashQuery', () => {
  it('matches a slash at the start or after whitespace', () => {
    expect(matchSlashQuery('/')).toBe('');
    expect(matchSlashQuery('/he')).toBe('he');
    expect(matchSlashQuery('hello /h1')).toBe('h1');
  });
  it('ignores slashes inside words or followed by other characters', () => {
    expect(matchSlashQuery('a/b')).toBeNull();
    expect(matchSlashQuery('/he llo')).toBeNull();
    expect(matchSlashQuery('plain')).toBeNull();
  });
});

describe('slashKeyAction', () => {
  it('maps navigation keys when there are matches', () => {
    expect(slashKeyAction('ArrowDown', 2)).toBe('next');
    expect(slashKeyAction('ArrowUp', 2)).toBe('prev');
    expect(slashKeyAction('Enter', 2)).toBe('execute');
  });
  it('lets keys through when nothing matches, but still closes on Escape', () => {
    expect(slashKeyAction('ArrowDown', 0)).toBeNull();
    expect(slashKeyAction('Enter', 0)).toBeNull();
    expect(slashKeyAction('Escape', 0)).toBe('close');
    expect(slashKeyAction('Escape', 3)).toBe('close');
    expect(slashKeyAction('a', 3)).toBeNull();
  });
  it('wraps the selection', () => {
    expect(stepSlashIndex(2, 3, 1)).toBe(0);
    expect(stepSlashIndex(0, 3, -1)).toBe(2);
    expect(stepSlashIndex(1, 3, 1)).toBe(2);
  });
});

describe('image helpers', () => {
  const file = (type: string) => ({ type }) as File;
  it('collects image files from clipboard items', () => {
    const img = file('image/png');
    const items = [
      { kind: 'file', type: 'image/png', getAsFile: () => img },
      { kind: 'file', type: 'text/plain', getAsFile: () => file('text/plain') },
      { kind: 'string', type: 'image/png', getAsFile: () => null },
      { kind: 'file', type: 'image/jpeg', getAsFile: () => null },
    ];
    expect(imageFilesFromClipboard(items)).toEqual([img]);
  });
  it('filters dropped files to images', () => {
    const a = file('image/gif');
    expect(imageFilesFromDrop([a, file('application/pdf')])).toEqual([a]);
  });
  it('words upload errors', () => {
    expect(imageUploadMessage(new Error('x'), true)).toMatch(/check your connection/);
    expect(imageUploadMessage(new Error('boom'), false)).toBe('Image upload failed: boom');
    expect(imageUploadMessage('str', false)).toBe('Image upload failed: str');
  });
});

describe('slash commands', () => {
  it('filters by key or label, case-insensitively', () => {
    expect(filterCommands('').length).toBe(COMMANDS.length);
    expect(filterCommands('H1').map((c) => c.key)).toEqual(['h1']);
    expect(filterCommands('list').map((c) => c.key)).toEqual(
      expect.arrayContaining(['bullet', 'number', 'tasklist']),
    );
    expect(filterCommands('zzzz')).toEqual([]);
  });
  it('routes the image command through the registered trigger', () => {
    const trigger = vi.fn();
    setImagePickerTrigger(trigger);
    COMMANDS.find((c) => c.key === 'image')!.action({} as never);
    expect(trigger).toHaveBeenCalledTimes(1);
    setImagePickerTrigger(null);
    expect(() => COMMANDS.find((c) => c.key === 'image')!.action({} as never)).not.toThrow();
  });
});
