import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * Intercept clicks on `<a href>` inside an element and route external
 * URLs to the OS default browser via Tauri's opener plugin. Without this
 * the webview either swallows the click or navigates the whole app
 * away.
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

  e.preventDefault();
  e.stopPropagation();

  openUrl(href).catch((err) => {
    console.warn('[openExternal] opener failed', href, err);
  });
}
