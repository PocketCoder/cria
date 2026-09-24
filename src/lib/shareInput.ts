/**
 * Extract a Vikunja link-share hash from user input: a full share URL
 * ({base}/share/{hash}[/auth]) or a bare hash. Null when neither matches.
 */
export function parseShareInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = /\/share\/([A-Za-z0-9]+)(?:\/auth)?(?:[?#]|$)/.exec(trimmed);
  if (urlMatch) return urlMatch[1]!;

  if (/^[A-Za-z0-9]+$/.test(trimmed) && !/^https?$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}
