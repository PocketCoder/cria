import DOMPurify from 'dompurify';

/**
 * Sanitise HTML coming from Vikunja's task descriptions before we
 * `dangerouslySetInnerHTML` it. The web client uses TipTap and accepts
 * pasted HTML, so anything goes through here as a defence-in-depth
 * against XSS even though the threat model is mostly "user owns their
 * own instance and trusts it."
 *
 * Allowlist mirrors what TipTap commonly emits: paragraphs, breaks,
 * headings, basic inline formatting, lists, links (rel-locked), code,
 * and blockquotes. No <script>, no event handlers, no <iframe>.
 */
// `Config` isn't a namespace export on the v3 module surface; the
// object below matches the documented option set and is accepted at
// runtime. Typed loosely on purpose so a dompurify version bump
// doesn't break the build.
const CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote',
    'a', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'span', 'img',
    'input', 'label',
    'ul', 'ol', 'li',       // task-list uses <ul data-type="taskList">
  ],
  // `data-src` is allowed because our VikunjaImage TipTap extension (and
  // Vikunja-web's matching one) store the real attachment URL there and
  // set `src="#"` to suppress the browser's unauthenticated fetch. The
  // image is then auth-fetched and the src swapped at runtime. See
  // src/features/task-detail/tiptapImageExtension.ts.
  //
  // `data-checked` is how TipTap's TaskItem records the checkbox state
  // on each <li data-type="taskItem">. Stripping it would round-trip
  // every checked item back to unchecked on the next pull because
  // TaskItem's parseHTML reads `el.dataset.checked === "true"`. Both
  // Cria and Vikunja-web rely on this attribute being preserved.
  ALLOWED_ATTR: ['href', 'title', 'class', 'rel', 'target', 'src', 'alt', 'type', 'checked', 'data-type', 'data-src', 'data-checked'],
  ALLOW_DATA_ATTR: false,
};

export function sanitizeHtml(html: string): string {
  const cleaned = DOMPurify.sanitize(html, CONFIG) as unknown as string;
  // Force external links to open safely. DOMPurify doesn't add rel by
  // default; this is the standard hardening.
  return cleaned.replace(
    /<a\s/gi,
    '<a target="_blank" rel="noopener noreferrer" ',
  );
}
