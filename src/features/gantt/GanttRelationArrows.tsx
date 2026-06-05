import type { GanttRelationEdge } from '@/db/relations';

/** Bar geometry needed to anchor an arrow: right/left edge x and row center y. */
export interface BarGeometry {
  left: number;
  right: number;
  cy: number;
}

/** Resolved arrow endpoint: the (possibly re-routed) anchor id + its geometry. */
export interface ArrowAnchor {
  id: string;
  geom: BarGeometry;
}

interface GanttRelationArrowsProps {
  relations: GanttRelationEdge[];
  /**
   * Resolve a task to where its arrow should anchor: itself if visible, the
   * nearest collapsed ancestor if hidden under one, or null to drop the arrow.
   */
  resolve: (taskLocalId: string) => ArrowAnchor | null;
  width: number;
  height: number;
}

const BLOCKING = '#ef4444'; // red — hard dependency
const PRECEDES = '#9ca3af'; // grey — ordering

/**
 * SVG overlay drawing dependency arrows between task bars: `blocking` solid
 * red, `precedes` dashed grey, each with an arrowhead at the target. An edge
 * is skipped unless *both* endpoints are currently visible (re-routing to a
 * collapsed ancestor, as Vikunja does, is not handled). Cubic bezier from the
 * source bar's right edge to the target bar's left edge. pointer-events:none
 * so it never intercepts bar drags.
 */
export function GanttRelationArrows({
  relations,
  resolve,
  width,
  height,
}: GanttRelationArrowsProps) {
  const seen = new Set<string>();
  const edges = relations
    .map((r) => {
      const from = resolve(r.fromLocalId);
      const to = resolve(r.toLocalId);
      // Drop if either end is hidden, or both collapsed onto the same anchor.
      if (!from || !to || from.id === to.id) return null;
      // Dedupe edges that re-routed onto the same anchor pair.
      const key = `${from.id}→${to.id}:${r.kind}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { from: from.geom, to: to.geom, kind: r.kind, key };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  if (edges.length === 0) return null;

  return (
    <svg
      width={width}
      height={height}
      className="pointer-events-none absolute left-0 top-0"
      style={{ overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        {(['blocking', 'precedes'] as const).map((kind) => (
          <marker
            key={kind}
            id={`gantt-arrow-${kind}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={kind === 'blocking' ? BLOCKING : PRECEDES} />
          </marker>
        ))}
      </defs>
      {edges.map(({ from, to, kind, key }) => {
        const x1 = from.right;
        const y1 = from.cy;
        const x2 = to.left;
        const y2 = to.cy;
        const dx = Math.max(16, Math.min(48, Math.abs(x2 - x1) / 2));
        const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        const blocking = kind === 'blocking';
        return (
          <path
            key={key}
            d={d}
            fill="none"
            stroke={blocking ? BLOCKING : PRECEDES}
            strokeWidth={1.5}
            strokeDasharray={blocking ? undefined : '6 4'}
            markerEnd={`url(#gantt-arrow-${kind})`}
          />
        );
      })}
    </svg>
  );
}
