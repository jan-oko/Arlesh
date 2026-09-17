import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked, entityNodeId } from "@/utils/tree-layout";
import type { TaskDependencyEdge } from "@/api/tasks";
import type { CommitmentListRow, TaskListRow } from "@/utils/list-filter";
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
 * Habit instances alike — Goals, Projects and Commitments never become task rows; a Commitment
 * gets its own section instead, via {@link flattenCommitmentRows}). Walks in
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

/**
 * Flattens the mindmap tree to one row per Commitment node.
 *
 * A second walk rather than a second kind of row in {@link flattenTaskRows}, because the two
 * feed different parts of the view: commitments render as their own section *above* the task
 * rows, so interleaving them in one ordered list and separating them again afterwards would
 * only destroy the ordering the section wants.
 */
export function flattenCommitmentRows(root: MindmapNode): CommitmentListRow[] {
  const rows: CommitmentListRow[] = [];
  function visit(node: MindmapNode, ancestors: readonly MindmapNode[]): void {
    if (node.kind === "commitment") {
      const parent = ancestors[ancestors.length - 1];
      rows.push({
        node,
        parentRef: parent?.id ?? "",
        ancestorRefs: ancestors.map((a) => a.id),
        ancestors: [...ancestors],
        hasPrivateAncestor: ancestors.some((a) => a.isPrivate === true),
        scopeTokens: deriveScopeStateTokens(node),
      });
    }
    const nextAncestors = node.id === "root" ? ancestors : [...ancestors, node];
    for (const child of node.children) visit(child, nextAncestors);
  }
  visit(root, []);
  return rows;
}

export type ListRowEntry =
  | { type: "goal"; node: MindmapNode }
  | { type: "task"; row: TaskListRow };

/**
 * Inserts a Goal header entry immediately before the first row of each contiguous run sharing the
 * same resolved Goal (SPEC: "positioned immediately before their child tasks"). No-op when
 * `showGoalHeaders` is off — plain task rows in their filtered order.
 */
export function groupRowsByGoal(rows: readonly TaskListRow[], showGoalHeaders: boolean): ListRowEntry[] {
  if (!showGoalHeaders) return rows.map((row) => ({ type: "task", row }));

  const entries: ListRowEntry[] = [];
  let lastGoalRef: string | null = null;
  for (const row of rows) {
    if (row.goalRef !== null && row.goalRef !== lastGoalRef) {
      const goalNode = row.ancestors.find((a) => a.id === row.goalRef);
      if (goalNode !== undefined) entries.push({ type: "goal", node: goalNode });
    }
    lastGoalRef = row.goalRef;
    entries.push({ type: "task", row });
  }
  return entries;
}
