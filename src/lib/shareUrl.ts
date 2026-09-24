/**
 * Public URL for a Vikunja link share, matching the upstream frontend's
 * /share/{hash}/auth route. Prefers the server-reported frontend_url;
 * otherwise derives the frontend base by stripping /api/v1 from the API url.
 */
export function shareUrlFor(
  serverUrl: string,
  frontendUrl: string | null | undefined,
  hash: string,
): string {
  const base = (frontendUrl?.trim() || serverUrl.replace(/\/api\/v1\/?$/, ''))
    .replace(/\/+$/, '');
  return `${base}/share/${hash}/auth`;
}
