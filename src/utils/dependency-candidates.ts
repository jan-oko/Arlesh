import type { Dependency } from "@/api/tasks";
import type { RowId } from "@/api/node-id";
import { can } from "@/utils/capabilities";
import type { SearchableNode } from "@/utils/mindmap-tree";
import type { MindmapNode } from "@/utils/tree-layout";

/** A node the `D` quick picker offers: a search row, and the edge picking it writes. */
export interface DependencyCandidate extends SearchableNode {
  dependency: Dependency;
}

/**
 * Whether `node` can be given a prerequisite: a Task with a row behind it that the backend lets hold
 * one (`nodes::rules::capabilities`) — a stored Task or a Habit occurrence. A wait's check task may
 * not; a folded run of Habit history draws no row to hang an edge on, and a flow item's
 * dependencies are the template's, edited in the Flow editor.
 */
export function canHoldDependencies(node: MindmapNode): boolean {
  return node.kind === "task" && node.virtual !== true && node.rowId !== undefined && can(node, "dependencies");
}

/** A dependency edge's target, as a key both sides spell alike. */
function dependencyKey(type: string, id: RowId): string {
  return `${type}:${String(id)}`;
}

/**
 * The nodes of the search pool `nodes` the backend offers as prerequisites (`allowed`, from
 * `fetchDependencyCandidates`), each with the edge picking it writes, in search order. Which nodes
 * may be depended on is the backend's answer; this only finds them in the pool, whose archived rule
 * applies unchanged.
 */
export function dependencyCandidates(
  nodes: readonly SearchableNode[],
  byId: ReadonlyMap<string, MindmapNode>,
  allowed: readonly Dependency[],
): DependencyCandidate[] {
  const offered = new Map(allowed.map((dependency) => [dependencyKey(dependency.type, dependency.id), dependency]));
  return nodes.flatMap((searchable) => {
    const node = byId.get(searchable.id);
    if (node?.rowId === undefined) return [];
    const dependency = offered.get(dependencyKey(node.kind, node.rowId));
    return dependency === undefined ? [] : [{ ...searchable, dependency }];
  });
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
