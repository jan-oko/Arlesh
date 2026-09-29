import type { Dependency, TaskDependencyEdge } from "@/api/tasks";
import type { RowId } from "@/api/node-id";
import { isDerivedWait } from "@/utils/derived-wait";
import type { SearchableNode } from "@/utils/mindmap-tree";
import type { MindmapNode } from "@/utils/tree-layout";

/** A node the `D` quick picker offers: a search row, and the edge picking it writes. */
export interface DependencyCandidate extends SearchableNode {
  dependency: Dependency;
}

/**
 * Whether `node` can be given a prerequisite: a Task with a row behind it — a stored Task or a
 * Habit occurrence. A wait's check task and a folded run of Habit history draw no row to hang an
 * edge on, and a flow item's dependencies are the template's, edited in the Flow editor.
 */
export function canHoldDependencies(node: MindmapNode): boolean {
  return node.kind === "task" && node.virtual !== true && node.rowId !== undefined && !isDerivedWait(node);
}

/**
 * The edge that makes a Task depend on `node`, or `null` when `node` cannot be depended on here.
 * A Task or a Goal (stored or an occurrence) and a **stored** Expectation can; a derived wait — a
 * check task, a delegated Task's wait, the wait an Asynchronous Task spawned — has no row an edge
 * can name, since an Expectation edge carries a stored id.
 */
export function dependencyOn(node: MindmapNode): Dependency | null {
  if (canHoldDependencies(node) && node.rowId !== undefined) return { type: "task", id: node.rowId };
  if (node.kind === "goal" && node.virtual !== true && node.rowId !== undefined) return { type: "goal", id: node.rowId };
  if (node.kind !== "expectation" || isDerivedWait(node) || typeof node.rowId !== "number") return null;
  return { type: "expectation", id: node.rowId };
}

function edgeKey(type: string, id: RowId): string {
  return `${type}:${String(id)}`;
}

/** Every Task that already depends on `dependent`, directly or through a chain — a pick among
 * them would close a cycle. `dependent` itself is included. */
function transitiveDependents(dependent: RowId, edges: readonly TaskDependencyEdge[]): Set<string> {
  const reached = new Set<string>([edgeKey("task", dependent)]);
  const stack: RowId[] = [dependent];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    const target = String(current);
    for (const edge of edges) {
      if (edge.dependency_type !== "task" || String(edge.dependency_id) !== target) continue;
      const key = edgeKey("task", edge.task_id);
      if (reached.has(key)) continue;
      reached.add(key);
      stack.push(edge.task_id);
    }
  }
  return reached;
}

/**
 * What `dependent` may be made to depend on, in search order: every Task, Goal and stored
 * Expectation among `nodes`, less the Task itself, what it already depends on, and every Task that
 * already depends on it (directly or through a chain), since that edge would close a cycle the
 * backend refuses. A Goal or an Expectation depends on nothing, so no cycle runs through one. `nodes` is the node search's own pool, so its archived rule applies unchanged.
 */
export function dependencyCandidates(
  dependent: MindmapNode,
  nodes: readonly SearchableNode[],
  byId: ReadonlyMap<string, MindmapNode>,
  edges: readonly TaskDependencyEdge[],
): DependencyCandidate[] {
  if (dependent.rowId === undefined) return [];
  const own = String(dependent.rowId);
  const existing = new Set(
    edges.filter((edge) => String(edge.task_id) === own).map((edge) => edgeKey(edge.dependency_type, edge.dependency_id)),
  );
  const excluded = transitiveDependents(dependent.rowId, edges);
  const candidates: DependencyCandidate[] = [];
  for (const searchable of nodes) {
    const node = byId.get(searchable.id);
    const dependency = node === undefined ? null : dependencyOn(node);
    if (dependency === null) continue;
    const key = edgeKey(dependency.type, dependency.id);
    if (existing.has(key) || excluded.has(key)) continue;
    candidates.push({ ...searchable, dependency });
  }
  return candidates;
}

/** The candidates whose title holds `query` (any case), at most `limit`; none until something is typed. */
export function matchCandidates(
  candidates: readonly DependencyCandidate[],
  query: string,
  limit: number,
): DependencyCandidate[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return candidates.filter((candidate) => candidate.title.toLowerCase().includes(needle)).slice(0, limit);
}
