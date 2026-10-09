import './mocks';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/features/task-detail/inlineImageUrls', () => ({
  inlineImageObjectUrl: vi.fn(async () => 'blob:http://localhost/runtime'),
}));
vi.mock('@/sync/attachments', () => ({
  inlineImageSource: (src: string | null, dataSrc: string | null) =>
    (dataSrc ?? src)?.includes('/attachments/')
      ? { kind: 'attachment', taskServerId: 1, attachmentServerId: 2 }
      : null,
}));

import { ReadView } from '@/features/task-detail/RichTextReadView';

const SRC = 'https://vik.example/api/v1/tasks/1/attachments/2';

describe('ReadView checkbox toggle', () => {
  it('saves the stored image src, not the runtime blob/# swap', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (_html: string) => {});
    const html =
      `<p><img src="${SRC}"></p>` +
      '<ul data-type="taskList">' +
      '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>a</p></div></li>' +
      '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>b</p></div></li>' +
      '</ul>';
    const { container } = render(
      <ReadView value={html} onEdit={() => {}} taskServerId={1} onSave={onSave} />,
    );
    // Wait for the runtime swap so the DOM really holds the blob URL.
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/),
    );

    await user.click(screen.getAllByRole('checkbox')[1]!);

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]![0];
    expect(saved).toContain(`<img src="${SRC}">`);
    expect(saved).not.toContain('blob:');
    expect(saved).not.toContain('src="#"');
    // Only the clicked (second) item flips.
    const lis = new DOMParser().parseFromString(saved, 'text/html').querySelectorAll('li');
    expect(lis[0]!.getAttribute('data-checked')).toBe('false');
    expect(lis[1]!.getAttribute('data-checked')).toBe('true');
    expect(lis[1]!.querySelector('input')!.hasAttribute('checked')).toBe(true);
  });
});
