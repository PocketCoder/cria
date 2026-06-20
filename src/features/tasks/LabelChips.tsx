import { memo } from 'react';
import { X } from 'lucide-react';
import type { Label } from '@/domain/label';

/**
 * Inline pill list for task labels. Uses the label's hex_color as the
 * background and picks a readable text colour. Keeps the chips tight so
 * the row height doesn't grow.
 *
 * When `onRemove` is supplied, each chip gains a hover-revealed × that
 * removes the label from the task. Without it the chips are read-only —
 * which is what the dense task-row usages (TaskList / SmartViews) want;
 * only the detail card passes `onRemove`.
 */
export const LabelChips = memo(function LabelChips({
  labels,
  onRemove,
}: {
  labels: Label[];
  onRemove?: (labelLocalId: string) => void;
}) {
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
            className="group/chip inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] leading-tight"
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
            {onRemove ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(l.localId);
                }}
                aria-label={`Remove label ${l.title}`}
                className="chip-reveal ml-0.5 inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full hover:bg-black/15 cursor-pointer"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
});

// Label colours are a tiny, stable set, so the parse/luminance work for each
// distinct hex only needs to happen once. These module-level caches keep the
// per-label-per-render math from re-running; unbounded Maps are fine here.
const normaliseCache = new Map<string, string | null>();
const lightCache = new Map<string, boolean>();

/** Normalise to `#rrggbb`; return null for empty/invalid. */
function normaliseHex(hex: string | null): string | null {
  if (!hex) return null;
  const cached = normaliseCache.get(hex);
  if (cached !== undefined) return cached;
  const trimmed = hex.trim().replace(/^#/, '');
  const result = /^[0-9a-f]{6}$/i.test(trimmed) ? `#${trimmed}` : null;
  normaliseCache.set(hex, result);
  return result;
}

/** Quick luminance test so chip text stays legible on bright fills. */
function isLight(hex: string): boolean {
  const cached = lightCache.get(hex);
  if (cached !== undefined) return cached;
  const m = hex.replace('#', '');
  if (m.length !== 6) {
    lightCache.set(hex, false);
    return false;
  }
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  // ITU-R BT.709 luma
  const result = 0.2126 * r + 0.7152 * g + 0.0722 * b > 160;
  lightCache.set(hex, result);
  return result;
}
