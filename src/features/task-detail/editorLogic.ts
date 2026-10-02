/** True when a description has no visible text (tags stripped). */
export function isEmptyDescription(html: string | null | undefined): boolean {
  return !html || !html.replace(/<[^>]*>/g, '').trim();
}

/**
 * "Empty" means no text AND no media-only content. An earlier check stripped
 * every tag before testing for text, which treated an image-only description
 * (`<p><img …></p>`) as empty and saved it as null — losing the user's inline
 * upload. Anything with an <img> / <hr> / <input checkbox> (task-list) counts
 * as real content.
 */
export function looksEmptyHtml(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, '').trim();
  const hasMedia = /<(img|hr|input)\b/i.test(html);
  return text === '' && !hasMedia;
}

/**
 * The slash-command query at the end of the text before the cursor: a slash at
 * the start of the block or after whitespace, followed by optional word
 * characters. Null when there is no slash command.
 */
export function matchSlashQuery(textBeforeCursor: string): string | null {
  const match = textBeforeCursor.match(/(?:^|\s)\/(\w*)$/);
  return match ? (match[1] ?? '') : null;
}

export type SlashKeyAction = 'next' | 'prev' | 'execute' | 'close' | null;

/** What a key does while the slash menu is open with `count` matching commands. */
export function slashKeyAction(key: string, count: number): SlashKeyAction {
  if (count > 0) {
    if (key === 'ArrowDown') return 'next';
    if (key === 'ArrowUp') return 'prev';
    if (key === 'Enter') return 'execute';
  }
  if (key === 'Escape') return 'close';
  return null;
}

/** Wrap-around selection step through `count` items. */
export function stepSlashIndex(current: number, count: number, dir: 1 | -1): number {
  return (current + dir + count) % count;
}

/** Image files in a clipboard item list. */
export function imageFilesFromClipboard(
  items: ArrayLike<{ kind: string; type: string; getAsFile: () => File | null }>,
): File[] {
  const files: File[] = [];
  for (const it of Array.from(items)) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}

/** Image files in a dropped FileList. */
export function imageFilesFromDrop(files: ArrayLike<File>): File[] {
  return Array.from(files).filter((f) => f.type.startsWith('image/'));
}

/** Upload error text shown above the editor. */
export function imageUploadMessage(err: unknown, offline: boolean): string {
  if (offline) return "Couldn't upload image — check your connection and try again.";
  const msg = String(err instanceof Error ? err.message : err);
  return `Image upload failed: ${msg}`;
}
