import type { Task } from '@/domain/task';

/**
 * Port of Vikunja's `ganttTaskTree`: turn a flat task list + parent→child
 * map into a depth-first list of nodes carrying their indent level and an
 * effective day range. Pure and deterministic (no `Date.now()`), so it's
 * unit-tested directly.
 *
 * Dates are represented as integer "day numbers" (UTC midnight days since
 * the epoch) so the chart's pixel math is plain integer arithmetic and never
 * shifts by timezone — a task date is a calendar day, not an instant.
 */
export interface GanttTaskNode {
  task: Task;
  /** Tree depth, capped at 4 (matching Vikunja). */
  indentLevel: number;
  isParent: boolean;
  childIds: string[];
  /** Effective range: the task's own dates, widened to cover descendants. */
  startDay: number | null;
  endDay: number | null;
  /** The task itself has a start and/or end date. */
  hasOwnDates: boolean;
  /** The range was derived purely from children (dateless parent). */
  hasDerivedDates: boolean;
}

/** ISO timestamp → UTC day number, or null for empty/invalid input. */
export function isoToDay(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86400000);
}

/** UTC day number → midnight-UTC ISO string (Vikunja's date convention). */
export function dayToIso(day: number): string {
  return new Date(day * 86400000).toISOString();
}

/** UTC day number → Date (read it back with the getUTC* accessors). */
export function dayToUtcDate(day: number): Date {
  return new Date(day * 86400000);
}

function ownRange(task: Task): {
  start: number | null;
  end: number | null;
  hasOwn: boolean;
} {
  const start = isoToDay(task.startDate);
  const end = isoToDay(task.endDate);
  return { start, end, hasOwn: start !== null || end !== null };
}

export function buildGanttTaskTree(
  tasks: Task[],
  childMap: Map<string, string[]>,
): GanttTaskNode[] {
  const taskMap = new Map(tasks.map((t) => [t.localId, t]));

  // Tasks that are children of a *present* parent are excluded from roots
  // (a child whose parent was filtered out still surfaces as a root).
  const childSet = new Set<string>();
  for (const [pid, kids] of childMap) {
    if (!taskMap.has(pid)) continue;
    for (const c of kids) if (taskMap.has(c)) childSet.add(c);
  }

  const effMemo = new Map<
    string,
    { start: number | null; end: number | null; derived: boolean }
  >();
  function effRange(
    id: string,
    seen: Set<string>,
  ): { start: number | null; end: number | null; derived: boolean } {
    const cached = effMemo.get(id);
    if (cached) return cached;
    if (seen.has(id)) return { start: null, end: null, derived: false }; // cycle guard
    seen.add(id);
    const own = ownRange(taskMap.get(id)!);
    let start = own.start;
    let end = own.end;
    let fromChild = false;
    for (const cid of childMap.get(id) ?? []) {
      if (!taskMap.has(cid)) continue;
      const cr = effRange(cid, seen);
      if (cr.start !== null) start = start === null ? cr.start : Math.min(start, cr.start);
      if (cr.end !== null) end = end === null ? cr.end : Math.max(end, cr.end);
      if (cr.start !== null || cr.end !== null) fromChild = true;
    }
    seen.delete(id);
    const res = { start, end, derived: !own.hasOwn && fromChild };
    effMemo.set(id, res);
    return res;
  }

  const result: GanttTaskNode[] = [];
  function visit(task: Task, indent: number): void {
    const childIds = (childMap.get(task.localId) ?? []).filter((c) =>
      taskMap.has(c),
    );
    const own = ownRange(task);
    const eff = effRange(task.localId, new Set());
    result.push({
      task,
      indentLevel: Math.min(indent, 4),
      isParent: childIds.length > 0,
      childIds,
      startDay: eff.start,
      endDay: eff.end,
      hasOwnDates: own.hasOwn,
      hasDerivedDates: eff.derived,
    });
    for (const cid of childIds) visit(taskMap.get(cid)!, indent + 1);
  }
  for (const t of tasks) {
    if (childSet.has(t.localId)) continue;
    visit(t, 0);
  }
  return result;
}

/**
 * Filter the pre-order node list down to what's actually drawn: descendants
 * of a collapsed node are hidden, and (when the toggle is off) so are
 * dateless tasks and their subtrees.
 */
export function visibleGanttNodes(
  nodes: GanttTaskNode[],
  collapsed: Set<string>,
  showDateless: boolean,
): GanttTaskNode[] {
  const result: GanttTaskNode[] = [];
  let hideDepth: number | null = null;
  for (const node of nodes) {
    // Inside a hidden/collapsed subtree? (descendants follow with deeper indent)
    if (hideDepth !== null && node.indentLevel > hideDepth) continue;
    hideDepth = null;

    if (!showDateless && node.startDay === null && node.endDay === null) {
      hideDepth = node.indentLevel; // hide this dateless node and its subtree
      continue;
    }
    result.push(node);
    if (collapsed.has(node.task.localId)) hideDepth = node.indentLevel;
  }
  return result;
}

/** child localId → parent localId, from the tree's childIds. */
export function buildParentMap(nodes: GanttTaskNode[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of nodes) {
    for (const c of n.childIds) m.set(c, n.task.localId);
  }
  return m;
}

/**
 * Resolve where a relation-arrow endpoint should anchor.
 * - If the task's own row is visible → itself.
 * - If it's hidden under a *collapsed* ancestor → that nearest visible
 *   (collapsed) ancestor, so the arrow points at the collapsed group.
 * - If it's hidden for any other reason (e.g. the dateless filter) → null,
 *   so the arrow is simply dropped.
 */
export function resolveVisibleAnchor(
  localId: string,
  visibleIds: Set<string>,
  parentMap: Map<string, string>,
  collapsed: Set<string>,
): string | null {
  if (visibleIds.has(localId)) return localId;
  const seen = new Set<string>();
  let cur = parentMap.get(localId);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (visibleIds.has(cur)) return collapsed.has(cur) ? cur : null;
    cur = parentMap.get(cur);
  }
  return null;
}
