import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked, entityNodeId } from "@/utils/tree-layout";
import type { TaskDependencyEdge } from "@/api/tasks";
import type { CommitmentListRow, ExpectationListRow, TaskListRow } from "@/utils/list-filter";
import { deriveScopeStateTokens } from "@/utils/list-filter";
import { isAgentic } from "@/utils/agentic";

/** The nearest (closest to `node`) ancestor of `kind`, searching from the immediate parent outward. */
function nearestOfKind(ancestors: readonly MindmapNode[], kind: MindmapNode["kind"]): MindmapNode | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i];
    if (ancestor !== undefined && ancestor.kind === kind) return ancestor;
  }
  return undefined;
}

function buildRow(node: MindmapNode, ancestors: readonly MindmapNode[], depsByTask: ReadonlyMap<number, string[]>): TaskListRow {
  const goal = nearestOfKind(ancestors, "goal");
  const project = nearestOfKind(ancestors, "project");
  return {
    node,
    ancestors: [...ancestors],
    goalRef: goal?.id ?? null,
    goalStatus: goal?.status ?? null,
    projectRef: project?.id ?? null,
    projectStatus: project?.status ?? null,
    // A virtual Habit occurrence draws no row, so no dependency edge can name it.
    dependencyRefs: (node.rowId === undefined ? undefined : depsByTask.get(node.rowId)) ?? [],
    isBlocked: isNodeBlocked(node),
    hasBlockedAncestor: ancestors.some(isNodeBlocked),
    isAgentic: isAgentic(node),
    isAsynchronous: node.asynchronous === true,
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
 *
 * `root` itself is the frame, not content: it is never a row and never a path segment. Pass the
 * true root for the whole board, or a subtree root to list just what is inside it.
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
    // The node we flatten from *frames* the list rather than appearing in it: it is neither a row
    // nor a path segment. That is the true root, or — once you have entered one — the subtree root,
    // which the top bar already names. Walking its children with no ancestors is what keeps the
    // root out of every header without a trimming pass that `visibleDepth` could fall out of step
    // with: a row's ancestors are simply the nodes stepped through to reach it.
    const isFrame = node === root;
    if (node.kind === "task" && !isFrame) rows.push(buildRow(node, ancestors, depsByTask));
    const nextAncestors = isFrame ? ancestors : [...ancestors, node];
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
      rows.push({
        node,
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

/**
 * Flattens the mindmap tree to one row per Expectation node — stored waits and the virtual ones
 * delegated Tasks carry alike. The walk mirrors {@link flattenCommitmentRows}.
 */
export function flattenExpectationRows(root: MindmapNode): ExpectationListRow[] {
  const rows: ExpectationListRow[] = [];
  function visit(node: MindmapNode, ancestors: readonly MindmapNode[]): void {
    const isFrame = node === root;
    if (node.kind === "expectation" && !isFrame) {
      rows.push({
        node,
        ancestors: [...ancestors],
        hasPrivateAncestor: ancestors.some((a) => a.isPrivate === true),
        scopeTokens: deriveScopeStateTokens(node),
      });
    }
    const nextAncestors = isFrame ? ancestors : [...ancestors, node];
    for (const child of node.children) visit(child, nextAncestors);
  }
  visit(root, []);
  return rows;
}

/** A path header: the ancestors a run of rows hangs from that are not rows themselves. */
export interface PathEntry { type: "path"; pathKey: string; segments: MindmapNode[] }
/** A task row, with the depth it is indented to. */
export interface TaskEntry { type: "task"; row: TaskListRow; visibleDepth: number }
/** A Commitment drawn as a row among the tasks (rows mode). */
export interface CommitmentEntry { type: "commitment"; row: CommitmentListRow; visibleDepth: number }
/** An Expectation drawn as a row among the tasks (rows mode). */
export interface ExpectationEntry { type: "expectation"; row: ExpectationListRow; visibleDepth: number }

/** One rendered List View entry: a **path header** naming a run's location, a row carrying the
 * depth it is indented to, or one of the two markers that bracket the **Asynchronous section**.
 * Header and depth partition a row's ancestors — the header names every ancestor *not* rendered as
 * a row above it, the depth counts every ancestor that *is* — so the list never implies a parent
 * that is not on screen.
 *
 * A row is a Task, or — when Commitments and Expectations are drawn as rows rather than in bands —
 * one of those. The two section markers carry nothing, and are drawn at most once each:
 * `asynchronous` is the heading that opens the section at the very top of the list,
 * `asynchronousEnd` the rule that closes it off from the ordinary list below. They are markers in
 * the stream rather than a wrapper around one, for the same reason a path header is: the list is
 * one flat run of rows, and the keyboard walks it in exactly the order it is drawn (see
 * `withAsynchronousSection`). */
export type ListRowEntry =
  | PathEntry | TaskEntry | CommitmentEntry | ExpectationEntry
  | { type: "asynchronous" }
  | { type: "asynchronousEnd" };

/** What path grouping of task rows alone can produce. */
export type PathGroupedEntry = PathEntry | TaskEntry;

/** What path grouping of mixed rows can produce. */
export type MixedGroupedEntry = PathEntry | TaskEntry | CommitmentEntry | ExpectationEntry;

/** One row of any kind the list can draw among the tasks, tagged with which it is. */
export type MixedListRow =
  | { type: "task"; row: TaskListRow }
  | { type: "commitment"; row: CommitmentListRow }
  | { type: "expectation"; row: ExpectationListRow };

/** Identity of a path: the ancestors it names, in order. Empty for a row with nothing above it. */
function pathKeyOf(segments: readonly MindmapNode[]): string {
  return segments.map((segment) => segment.id).join("\u0000");
}

/**
 * Inserts a path header immediately before the first row of each contiguous run sharing the same
 * path. Rows arrive in tree pre-order, so rows sharing a path are already contiguous — no sort or
 * grouping pass is needed.
 *
 * A row's path is every ancestor the caller did not give us as a row: Goals, Projects, Domains and
 * Aspects always (they are never List View rows), plus any ancestor row the active filter hid. What
 * the header leaves out is exactly what the indentation shows, so the two never repeat each other.
 * A run with an empty path — a row with no ancestors — gets no header rather than a blank one.
 */
export function groupMixedRowsByPath(rows: readonly MixedListRow[]): MixedGroupedEntry[] {
  const rowIds = new Set(rows.map((mixed) => mixed.row.node.id));
  const entries: MixedGroupedEntry[] = [];
  let lastPathKey: string | null = null;
  for (const mixed of rows) {
    const segments = mixed.row.ancestors.filter((ancestor) => !rowIds.has(ancestor.id));
    const pathKey = pathKeyOf(segments);
    if (segments.length > 0 && pathKey !== lastPathKey) entries.push({ type: "path", pathKey, segments });
    lastPathKey = pathKey;
    const visibleDepth = mixed.row.ancestors.length - segments.length;
    entries.push({ ...mixed, visibleDepth });
  }
  return entries;
}

/** {@link groupMixedRowsByPath} over task rows alone — what a task-only list draws. */
export function groupRowsByPath(rows: readonly TaskListRow[]): PathGroupedEntry[] {
  return groupMixedRowsByPath(rows.map((row) => ({ type: "task" as const, row })))
    .filter((entry): entry is PathGroupedEntry => entry.type === "path" || entry.type === "task");
}

/**
 * Merges rows of every kind into the order the tree draws them in — the pre-order `order` gives
 * each node id — so a Commitment or an Expectation drawn as a row sits exactly where it hangs.
 */
export function mergeInTreeOrder(
  rows: readonly MixedListRow[],
  order: ReadonlyMap<string, number>,
): MixedListRow[] {
  const rank = (mixed: MixedListRow): number => order.get(mixed.row.node.id) ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

/** Every node id under `root`, numbered in pre-order — the order the tree, and so the list, draws. */
export function preOrderIndex(root: MindmapNode): Map<string, number> {
  const order = new Map<string, number>();
  function visit(node: MindmapNode): void {
    order.set(node.id, order.size);
    for (const child of node.children) visit(child);
  }
  visit(root);
  return order;
}
