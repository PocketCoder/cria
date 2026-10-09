import './mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommentSection } from '@/features/task-detail/CommentSection';
import { createTask } from '@/db/tasks';
import { createComment, listCommentsForTask } from '@/db/comments';
import { queueAttachmentUpload } from '@/sync/attachments';
import { pendingAttachmentRef } from '@/lib/pendingAttachmentRef';
import { renderWithProviders, resetDb, signIn } from './render';
import { seedProject } from '../unit/_helpers';

// Inline images in comments load through the same authenticated path as the
// description. `signIn()` puts the server at https://vikunja.test.

const ATTACHMENT = /\/api\/v1\/tasks\/(\d+)\/attachments\/(\d+)$/;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

let taskId = '';
let fetchMock: ReturnType<typeof vi.fn>;
let objectUrls = 0;

/** Attachment fetches made so far, with the Authorization header sent. */
function attachmentFetches(): Array<{ url: string; auth: string | null }> {
  return fetchMock.mock.calls
    .map(([input, init]) => ({
      url: String(input),
      auth: new Headers((init as RequestInit | undefined)?.headers).get('Authorization'),
    }))
    .filter((c) => ATTACHMENT.test(c.url));
}

beforeEach(async () => {
  await resetDb();
  signIn();
  const projectId = await seedProject(1, 'Home');
  taskId = (await createTask({ title: 'Fix the shelf', projectLocalId: projectId })).localId;

  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (ATTACHMENT.test(url)) {
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => `blob:test/${++objectUrls}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderThread() {
  return renderWithProviders(
    <CommentSection taskLocalId={taskId} taskServerId={7} hideHeader />,
  );
}

async function storedComment(): Promise<string> {
  const [c] = await listCommentsForTask(taskId);
  return c!.comment;
}

describe('comment inline images', () => {
  it('loads an image Vikunja-web stored, with the token', async () => {
    // Vikunja-web v2.7.0's CustomImage output (v2 URL behind src="#").
    await createComment(
      taskId,
      '<p>Before</p><p><img data-src="https://vikunja.test/api/v2/tasks/7/attachments/9" src="#" alt="Web shelf" id="tiptap-image-7-9"></p>',
    );
    renderThread();

    const img = await screen.findByAltText('Web shelf');
    await waitFor(() => expect(img.getAttribute('src')).toMatch(/^blob:test\//));
    expect(img.hasAttribute('id')).toBe(false); // sanitised away
    expect(attachmentFetches()).toEqual([
      { url: 'https://vikunja.test/api/v1/tasks/7/attachments/9', auth: 'Bearer test-token' },
    ]);
  });

  it('loads an older src-only image', async () => {
    await createComment(
      taskId,
      '<p><img src="https://vikunja.test/api/v1/tasks/7/attachments/10" alt="Old shelf"></p>',
    );
    renderThread();

    const img = await screen.findByAltText('Old shelf');
    await waitFor(() => expect(img.getAttribute('src')).toMatch(/^blob:test\//));
  });

  it('loads a queued upload from the local bytes', async () => {
    const localId = await queueAttachmentUpload(
      taskId,
      new File([PNG], 'queued.png', { type: 'image/png' }),
    );
    await createComment(
      taskId,
      `<p><img src="#" data-src="${pendingAttachmentRef(localId)}" alt="Queued shelf"></p>`,
    );
    renderThread();

    const img = await screen.findByAltText('Queued shelf');
    await waitFor(() => expect(img.getAttribute('src')).toMatch(/^blob:test\//));
    const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as Blob;
    expect(blob.type).toBe('image/png');
    expect(attachmentFetches()).toEqual([]);
  });

  it('leaves images on other hosts alone and strips unsafe markup', async () => {
    await createComment(
      taskId,
      '<p><img src="https://elsewhere.example/x.png" alt="Elsewhere" onerror="alert(1)"></p><script>alert(2)</script>',
    );
    const { container } = renderThread();

    const img = await screen.findByAltText('Elsewhere');
    expect(img.getAttribute('src')).toBe('https://elsewhere.example/x.png');
    expect(img.hasAttribute('onerror')).toBe(false);
    expect(container.querySelector('script')).toBeNull();
    expect(attachmentFetches()).toEqual([]);
  });

  // Edit then save without changes: the image keeps the URL it was stored
  // with (Vikunja-web's v2, Cria's v1 or a still-queued upload), behind
  // src="#" as Vikunja-web writes it, never the object URL shown on screen.
  it.each([
    ['a Vikunja-web v2 URL', async () => 'https://vikunja.test/api/v2/tasks/7/attachments/11'],
    ['a v1 URL', async () => 'https://vikunja.test/api/v1/tasks/7/attachments/12'],
    [
      'a queued upload',
      async () =>
        pendingAttachmentRef(
          await queueAttachmentUpload(taskId, new File([PNG], 'q.png', { type: 'image/png' })),
        ),
    ],
  ])('round-trips %s through the comment editor', async (_label, makeSrc) => {
    const user = userEvent.setup();
    const src = await makeSrc();
    await createComment(
      taskId,
      `<p>Look</p><p><img data-src="${src}" src="#" alt="Edit shelf" id="tiptap-image-7-11"></p>`,
    );
    const original = await storedComment();
    renderThread();
    await waitFor(() =>
      expect(screen.getByAltText('Edit shelf').getAttribute('src')).toMatch(/^blob:/),
    );

    await user.click(screen.getByTitle('Edit comment'));
    const save = await screen.findByRole('button', { name: 'Save' });
    // The editor shows the image too.
    await waitFor(() =>
      expect(screen.getByAltText('Edit shelf').getAttribute('src')).toMatch(/^blob:/),
    );
    await user.click(save);

    await waitFor(async () => expect(await storedComment()).not.toBe(original));
    const saved = await storedComment();
    expect(saved).toContain('<p>Look</p>');
    const stored = new DOMParser().parseFromString(saved, 'text/html').querySelector('img')!;
    expect(stored.getAttribute('data-src')).toBe(src);
    expect(stored.getAttribute('src')).toBe('#');
    expect(stored.getAttribute('alt')).toBe('Edit shelf');
    expect(saved).not.toContain('blob:');
    expect(saved).not.toMatch(/\bid=/);
  });
});
