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
