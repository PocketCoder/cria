import type { Task } from '@/domain/task';

export interface TaskTreeNode {
  task: Task;
  children: TaskTreeNode[];
}

export function buildTaskTree(tasks: Task[], parentMap: Map<string, string[]>): TaskTreeNode[] {
  const taskMap = new Map(tasks.map((t) => [t.localId, t]));
  // Only treat a task as "nested" (and exclude it from the top level)
  // when its parent is actually present in the visible set. Otherwise a
  // child whose parent is filtered out (e.g. a done parent hidden by the
  // current view) — or a stale relation row whose parent task no longer
  // exists locally — would be dropped from roots but never rendered as a
  // child, making it vanish entirely.
  const childSet = new Set<string>();
  for (const [parentId, children] of parentMap) {
    if (!taskMap.has(parentId)) continue;
    for (const c of children) childSet.add(c);
  }

  function childrenOf(parentId: string): TaskTreeNode[] {
    return (parentMap.get(parentId) ?? [])
      .map((childId) => {
        const t = taskMap.get(childId);
        if (!t) return null;
        return { task: t, children: childrenOf(childId) };
      })
      .filter(Boolean) as TaskTreeNode[];
  }

  return tasks
    .filter((t) => !childSet.has(t.localId))
    .map((t) => ({ task: t, children: childrenOf(t.localId) }));
}

// Collect a task and all its descendants from the task tree
export function collectSubtreeIds(taskId: string, nodes: TaskTreeNode[]): string[] {
  const find = (list: TaskTreeNode[]): TaskTreeNode | undefined => {
    for (const n of list) {
      if (n.task.localId === taskId) return n;
      const child = find(n.children);
      if (child) return child;
    }
    return undefined;
  };
  const root = find(nodes);
  if (!root) return [];
  const out: string[] = [];
  const dfs = (n: TaskTreeNode) => { out.push(n.task.localId); n.children.forEach(dfs); };
  dfs(root);
  return out;
}

/** Every task id in display (depth-first) order. */
export function flattenTreeIds(nodes: TaskTreeNode[]): string[] {
  const out: string[] = [];
  const dfs = (list: TaskTreeNode[]) => {
    for (const n of list) {
      out.push(n.task.localId);
      dfs(n.children);
    }
  };
  dfs(nodes);
  return out;
}

/**
 * Order the root nodes by `orderedIds`. Roots not yet reflected in
 * `orderedIds` (e.g. a just-added task) are appended so nothing flashes out.
 */
export function orderRoots(roots: TaskTreeNode[], orderedIds: string[]): TaskTreeNode[] {
  const byId = new Map(roots.map((n) => [n.task.localId, n]));
  const seen = new Set<string>();
  const ordered: TaskTreeNode[] = [];
  for (const id of orderedIds) {
    const node = byId.get(id);
    if (node) {
      ordered.push(node);
      seen.add(id);
    }
  }
  for (const node of roots) {
    if (!seen.has(node.task.localId)) ordered.push(node);
  }
  return ordered;
}

/**
 * Resolve a drop target to its top-level root: only roots are sortable, so
 * landing on a child counts as landing on that child's root.
 */
export function resolveRootTargetId(overId: string, roots: TaskTreeNode[]): string {
  for (const root of roots) {
    if (collectSubtreeIds(root.task.localId, roots).includes(overId)) {
      return root.task.localId;
    }
  }
  return overId;
}
