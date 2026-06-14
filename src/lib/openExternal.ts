import { openUrl } from '@tauri-apps/plugin-opener';

const ALLOWED_SCHEMES = ['https:', 'http:', 'mailto:'];

/**
 * Intercept clicks on `<a href>` inside an element and route external
 * URLs to the OS default browser via Tauri's opener plugin. Without this
 * the webview either swallows the click or navigates the whole app
 * away.
 *
 * Only opens URLs with allowed schemes (https, http, mailto).
 *
 * Returns a click handler suitable for an element's `onClick` prop.
 */
export function onLinkClickOpenExternal(
  e: React.MouseEvent<HTMLElement>,
): void {
  const target = e.target as HTMLElement;
  const anchor = target.closest<HTMLAnchorElement>('a[href]');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#')) return;

  try {
    const url = new URL(href);
    if (!ALLOWED_SCHEMES.includes(url.protocol)) {
      console.warn('[openExternal] blocked scheme:', url.protocol);
      return;
    }
  } catch {
    return; // malformed URL
  }

  e.preventDefault();
  e.stopPropagation();

  openUrl(href).catch((err) => {
    console.warn('[openExternal] opener failed', href, err);
  });
}
