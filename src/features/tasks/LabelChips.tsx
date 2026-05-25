import type { Label } from '@/domain/label';

/**
 * Inline pill list for task labels. Uses the label's hex_color as the
 * background and picks a readable text colour. Keeps the chips tight so
 * the row height doesn't grow.
 */
export function LabelChips({ labels }: { labels: Label[] }) {
  if (labels.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1">
      {labels.map((l) => {
        const bg = normaliseHex(l.hexColor) ?? 'var(--color-muted)';
        const fg =
          normaliseHex(l.hexColor) && isLight(bg) ? '#111' : 'inherit';
        return (
          <li
            key={l.localId}
            title={l.description ?? l.title}
            className="rounded-full px-1.5 py-px text-[10px] leading-tight"
            style={{
              background: bg,
              color: fg,
              border:
                normaliseHex(l.hexColor) === null
                  ? '1px solid var(--color-border)'
                  : 'none',
            }}
          >
            {l.title}
          </li>
        );
      })}
    </ul>
  );
}

/** Normalise to `#rrggbb`; return null for empty/invalid. */
function normaliseHex(hex: string | null): string | null {
  if (!hex) return null;
  const trimmed = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(trimmed)) return null;
  return `#${trimmed}`;
}

/** Quick luminance test so chip text stays legible on bright fills. */
function isLight(hex: string): boolean {
  const m = hex.replace('#', '');
  if (m.length !== 6) return false;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  // ITU-R BT.709 luma
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 160;
}
