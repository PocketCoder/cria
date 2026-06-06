/**
 * Calculate a position value between two existing positions for ordering.
 *
 * Uses the midpoint strategy: the new position sits halfway between `before`
 * and `after`. If both neighbours are undefined, returns the base step as a
 * starting point. If only one neighbour exists, offsets from it.
 *
 * This lets us insert items between any two neighbours without re-indexing
 * the entire list. Over many insertions near the same gap, floating-point
 * precision may eventually converge (~2³² midpoint operations before
 * collapsing); at that point a re-index (batch-rewrite all positions in
 * integer steps) is trivial and cheap for a few hundred items.
 */
export function calculatePosition(
  before: number | null | undefined,
  after: number | null | undefined,
  baseStep = 1024,
): number {
  const b = before ?? null;
  const a = after ?? null;

  if (b === null && a === null) return baseStep;
  if (a === null) return b! + baseStep;
  if (b === null) return a / 2;

  // Midpoint between two neighbours
  return (b + a) / 2;
}

/**
 * Whether a midpoint insertion between `before` and `after` is safe to
 * persist as the *only* position change.
 *
 * The midpoint strategy assumes every task already has a distinct, ordered
 * position. That assumption breaks in two real cases:
 *   - Locally-created tasks start with `position = null` (they sort by
 *     title/date), so the neighbours of a drop have no usable position.
 *   - Two neighbours collide (equal positions, e.g. a server that handed
 *     everyone `0`), so their midpoint equals both — no gap to insert into.
 * In either case the caller must re-index the whole list instead of writing
 * a single midpoint, otherwise the moved task lands in the wrong place (or,
 * with the `position IS NULL` sort, jumps to the top). When this returns
 * true the midpoint is a strictly-between value and a single write is enough.
 */
export function canMidpoint(
  before: number | null | undefined,
  after: number | null | undefined,
): boolean {
  const b = before ?? null;
  const a = after ?? null;

  if (b === null && a === null) return false; // no anchors → re-index
  if (b === null) return a! > 0; // inserting at top needs room below `after`
  if (a === null) return true; // inserting at bottom: before + step always fits
  return b < a; // strictly-increasing distinct neighbours
}
