import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";

/** Status preset a filter is in. `all` disables status filtering. */
export type StatusMode = "all" | "plan" | "start" | "do";

/** How a single tag filter contributes to the combined tag predicate (SPEC Filtering Logic). */
export type TagFilterMode = "any" | "all" | "exclude";

/** One tag filter: a tag id in one of the three modes. */
export interface TagFilter {
  tagId: number;
  mode: TagFilterMode;
}

/** The full filter state (persisted). */
export interface FilterState {
  statusMode: StatusMode;
  /** Plan/Start per-mode "include flows" subtoggle (separate from the global `showFlow`). */
  modeIncludeFlows: boolean;
  tagFilters: TagFilter[];
  showInfo: boolean;
  showFlow: boolean;
}

/** The neutral, indicator-off filter — shows everything. */
export const DEFAULT_FILTER: FilterState = {
  statusMode: "all",
  modeIncludeFlows: true,
  tagFilters: [],
  showInfo: true,
  showFlow: true,
};

/** Goal statuses that read as resolved/inactive (hidden by Plan/Start). */
const RESOLVED_GOAL = new Set(["achieved", "frozen", "archived"]);

const FLOW_KINDS = new Set(["flow", "flow_goal", "flow_task"]);

/** Whether the filter differs from the neutral state (drives the top-bar active badge). */
export function isFilterActive(f: FilterState): boolean {
  return f.statusMode !== "all" || f.tagFilters.length > 0 || !f.showInfo || !f.showFlow;
}

/**
 * A flow subtree is hidden as a unit (not softly, via ancestor-keeping) when: the global Flow toggle
 * is off; the mode excludes flows (Do, or Plan/Start with the per-mode subtoggle off); or a Habit flow
 * node under Start. Hard-hiding the flow node drops its whole item subtree.
 */
function flowHardHidden(node: MindmapNode, f: FilterState): boolean {
  if (!FLOW_KINDS.has(node.kind)) return false;
  if (!f.showFlow) return true;
  if (node.kind === "flow") {
    if (f.statusMode === "do") return true;
    if ((f.statusMode === "plan" || f.statusMode === "start") && !f.modeIncludeFlows) return true;
    if (f.statusMode === "start" && node.flow?.isHabit === true) return true;
  }
  return false;
}

/** Kinds hidden outright (their subtree is removed, not kept as an ancestor). */
function typeHardHidden(node: MindmapNode, f: FilterState): boolean {
  if (node.kind === "info" && !f.showInfo) return true;
  return flowHardHidden(node, f);
}

/** Whether a node's own status satisfies the active mode (structural/other kinds pass except in Do). */
function passesStatus(node: MindmapNode, f: FilterState): boolean {
  switch (f.statusMode) {
    case "all":
      return true;
    case "plan":
      if (node.kind === "task") return node.status !== "done";
      if (node.kind === "goal") return !RESOLVED_GOAL.has(node.status ?? "");
      return true;
    case "start": {
      if (node.kind !== "task" && node.kind !== "goal") return true;
      // Start = things you can begin now: drop anything archived by scope (lapsed) or blocked.
      if (node.scopeLifecycle === "lapsed") return false;
      if (isNodeBlocked(node)) return false;
      if (node.kind === "goal") return !RESOLVED_GOAL.has(node.status ?? "");
      if (node.status === "done") return false;
      // An in-progress task with nothing left to start (no direct todo child) drops out.
      if (node.status === "in_progress" && !node.children.some((c) => c.kind === "task" && c.status === "todo")) {
        return false;
      }
      return true;
    }
    case "do":
      // Only in-progress tasks match; goals/structure appear solely as ancestors.
      return node.kind === "task" && node.status === "in_progress";
  }
}

/** Combined tag predicate per SPEC: (∪Any) ∧ (∩All) ∧ ¬(∪Exclude). Only judges taggable nodes. */
function passesTags(node: MindmapNode, f: FilterState): boolean {
  if (f.tagFilters.length === 0) return true;
  if (node.kind !== "task" && node.kind !== "goal") return true;
  const has = (id: number) => node.tagIds.includes(id);
  const any = f.tagFilters.filter((t) => t.mode === "any");
  if (any.length > 0 && !any.some((t) => has(t.tagId))) return false;
  if (!f.tagFilters.filter((t) => t.mode === "all").every((t) => has(t.tagId))) return false;
  if (f.tagFilters.filter((t) => t.mode === "exclude").some((t) => has(t.tagId))) return false;
  return true;
}

function selfMatches(node: MindmapNode, f: FilterState): boolean {
  return passesStatus(node, f) && passesTags(node, f);
}

/**
 * Prunes `root` to the active filter: a node is kept if it matches or has a kept descendant (so matches
 * stay reachable); type/flow-hidden subtrees are dropped outright. The root is always returned as a
 * container (possibly empty) so the canvas has something to render.
 */
export function filterTree(root: MindmapNode, f: FilterState): MindmapNode {
  function prune(node: MindmapNode): MindmapNode | null {
    if (typeHardHidden(node, f)) return null;
    const children = node.children
      .map(prune)
      .filter((n): n is MindmapNode => n !== null);
    if (selfMatches(node, f) || children.length > 0) return { ...node, children };
    return null;
  }
  return prune(root) ?? { ...root, children: [] };
}
