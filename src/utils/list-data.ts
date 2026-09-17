import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked, entityNodeId } from "@/utils/tree-layout";
import type { TaskDependencyEdge } from "@/api/tasks";
import type { TaskListRow } from "@/utils/list-filter";
import { deriveScopeStateTokens } from "@/utils/list-filter";

/** The nearest (closest to `node`) ancestor of `kind`, searching from the immediate parent outward. */
function nearestOfKind(ancestors: readonly MindmapNode[], kind: MindmapNode["kind"]): MindmapNode | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i];
    if (ancestor !== undefined && ancestor.kind === kind) return ancestor;
  }
  return undefined;
}

function buildRow(node: MindmapNode, ancestors: readonly MindmapNode[], depsByTask: ReadonlyMap<number, string[]>): TaskListRow {
  const parent = ancestors[ancestors.length - 1];
  const goal = nearestOfKind(ancestors, "goal");
  const project = nearestOfKind(ancestors, "project");
  const dbId = parseInt(node.id.split("-").pop() ?? "", 10);
  return {
    node,
    parentRef: parent?.id ?? "",
    ancestorRefs: ancestors.map((a) => a.id),
    ancestors: [...ancestors],
    goalRef: goal?.id ?? null,
    goalStatus: goal?.status ?? null,
    projectRef: project?.id ?? null,
    projectStatus: project?.status ?? null,
    dependencyRefs: depsByTask.get(dbId) ?? [],
    isBlocked: isNodeBlocked(node),
    hasBlockedAncestor: ancestors.some(isNodeBlocked),
    hasPrivateAncestor: ancestors.some((a) => a.isPrivate === true),
    scopeTokens: deriveScopeStateTokens(node),
  };
}

/**
 * Flattens the mindmap tree to one row per Task node (real, materialized-from-flow, and virtual
 * Habit instances alike — Goals, Projects, and every other kind are never List View rows). Walks in
 * the same pre-order as the tree's own (position-sorted) children, so tasks under the same resolved
 * Goal/Project already come out contiguous — no separate grouping pass is needed.
 */
export function flattenTaskRows(root: MindmapNode, taskDeps: readonly TaskDependencyEdge[]): TaskListRow[] {
  const depsByTask = new Map<number, string[]>();
  for (const dep of taskDeps) {
    const ref = entityNodeId(dep.dependency_type, dep.dependency_id);
    const list = depsByTask.get(dep.task_id);
    if (list === undefined) depsByTask.set(dep.task_id, [ref]);
    else list.push(ref);
  }

  const rows: TaskListRow[] = [];
  function visit(node: MindmapNode, ancestors: readonly MindmapNode[]): void {
    if (node.kind === "task") rows.push(buildRow(node, ancestors, depsByTask));
    const nextAncestors = node.id === "root" ? ancestors : [...ancestors, node];
    for (const child of node.children) visit(child, nextAncestors);
  }
  visit(root, []);
  return rows;
}

/** One rendered List View entry: a **path header** naming a run's location, or a task row carrying
 * the depth it is indented to. The two halves partition a row's ancestors — the header names every
 * ancestor *not* rendered as a row above it, the depth counts every ancestor that *is* — so the list
 * never implies a parent that is not on screen. */
export type ListRowEntry =
  | { type: "path"; pathKey: string; segments: MindmapNode[] }
  | { type: "task"; row: TaskListRow; visibleDepth: number };

/** Identity of a path: the ancestors it names, in order. Empty for a row with nothing above it. */
function pathKeyOf(segments: readonly MindmapNode[]): string {
  return segments.map((segment) => segment.id).join("\u0000");
}

/**
 * Inserts a path header immediately before the first row of each contiguous run sharing the same
 * path. Rows arrive from flattenTaskRows in tree pre-order, so rows sharing a path are already
 * contiguous — no sort or grouping pass is needed.
 *
 * A row's path is every ancestor the caller did not give us as a row: Goals, Projects, Domains and
 * Aspects always (they are never List View rows), plus any ancestor Task the active filter hid. What
 * the header leaves out is exactly what the indentation shows, so the two never repeat each other.
 * A run with an empty path — a task with no ancestors — gets no header rather than a blank one.
 */
export function groupRowsByPath(rows: readonly TaskListRow[]): ListRowEntry[] {
  const rowIds = new Set(rows.map((row) => row.node.id));
  const entries: ListRowEntry[] = [];
  let lastPathKey: string | null = null;
  for (const row of rows) {
    const segments = row.ancestors.filter((ancestor) => !rowIds.has(ancestor.id));
    const pathKey = pathKeyOf(segments);
    if (segments.length > 0 && pathKey !== lastPathKey) entries.push({ type: "path", pathKey, segments });
    lastPathKey = pathKey;
    entries.push({ type: "task", row, visibleDepth: row.ancestors.length - segments.length });
  }
  return entries;
}
