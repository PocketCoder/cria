// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { setTaskItemChecked } from '@/features/task-detail/editorLogic';

const item = (checked: boolean, text: string) =>
  `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${
    checked ? ' checked="checked"' : ''
  }></label><div><p>${text}</p></div></li>`;

describe('setTaskItemChecked', () => {
  it('flips only the Nth item and leaves the rest of the HTML untouched', () => {
    const img = '<p><img src="https://s/api/v1/tasks/1/attachments/2" alt="x"></p>';
    const html = `${img}<ul data-type="taskList">${item(false, 'a')}${item(true, 'b')}</ul>`;
    expect(setTaskItemChecked(html, 0, true)).toBe(
      `${img}<ul data-type="taskList">${item(true, 'a')}${item(true, 'b')}</ul>`,
    );
    expect(setTaskItemChecked(html, 1, false)).toContain(item(false, 'b'));
  });

  it('keeps data-src images as stored', () => {
    const html = `<img data-src="https://s/a/1" src="#"><ul data-type="taskList">${item(false, 'a')}</ul>`;
    expect(setTaskItemChecked(html, 0, true)).toContain('<img data-src="https://s/a/1" src="#">');
  });

  it('returns null for an out-of-range index', () => {
    expect(setTaskItemChecked('<p>x</p>', 0, true)).toBeNull();
  });
});
