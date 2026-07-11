import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";

/** Status preset a filter is in. `all` disables status filtering. */
export type StatusMode = "all" | "plan" | "start" | "do";

/** How a single tag filter contributes to the combined tag predicate (SPEC Filtering Logic). */
export type TagFilterMode = "any" | "all" | "exclude";

/** Override for Archived-status/scope-Lapsed nodes, on top of whatever the status preset would
 * otherwise decide. `inactive` defers entirely to the preset (today's exact behavior). */
export type ArchivedMode = "inactive" | "include" | "exclude";

/** The mode `archivedMode` advances to when its pill is clicked (Inactive → Include → Exclude → Inactive). */
export const NEXT_ARCHIVED_MODE: Record<ArchivedMode, ArchivedMode> = {
  inactive: "include",
  include: "exclude",
  exclude: "inactive",
};

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
  /** Work mode: hard-hide any NSFW-marked node together with its whole subtree. */
  workMode: boolean;
  /** Override for Archived-status/scope-Lapsed nodes on top of the status preset. */
  archivedMode: ArchivedMode;
}

/** The neutral, indicator-off filter — shows everything. */
export const DEFAULT_FILTER: FilterState = {
  statusMode: "all",
  modeIncludeFlows: true,
  tagFilters: [],
  showInfo: true,
  showFlow: true,
  workMode: false,
  archivedMode: "inactive",
};

/** Goal statuses that read as resolved/inactive (hidden by Plan/Start). */
const RESOLVED_GOAL = new Set(["achieved", "frozen", "archived"]);

const FLOW_KINDS = new Set(["flow", "flow_goal", "flow_task"]);
/** Container kinds with no status of their own — shown only as ancestors of a content match. */
const STRUCTURAL_KINDS = new Set(["aspect", "domain", "project", "tag"]);


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

/** An Archived-status node, or one whose effective Archival was derived as archived (a scope
 * Resolution of Completed or Missed forces this, regardless of done-ness — SPEC treats both as
 * "archived-looking", same status-row icon, and the archivedMode filter governs both together). */
function isArchived(node: MindmapNode): boolean {
  return node.status === "archived" || node.archived === true;
}

/** Kinds hidden outright (their subtree is removed, not kept as an ancestor). */
export function typeHardHidden(node: MindmapNode, f: FilterState): boolean {
  // Work mode drops any NSFW node and everything beneath it, regardless of kind.
  if (f.workMode && node.nsfw === true) return true;
  if (node.kind === "info" && !f.showInfo) return true;
  // In Start, a blocked task/goal gates its whole subtree: drop it outright rather than merely
  // failing its self-match, which would otherwise keep it as an ancestor of a startable descendant.
  if (f.statusMode === "start" && isNodeBlocked(node)) return true;
  // archivedMode Exclude gates the whole subtree, same as blocked/NSFW above — otherwise an excluded
  // Habit-instance goal with one still-undone (also-excluded) item and one already-`done` item would
  // stay visible anyway, kept as an ancestor of that unrelated, ordinarily-visible done sibling.
  if (f.archivedMode === "exclude" && isArchived(node)) return true;
  return flowHardHidden(node, f);
}

/** Forces an archived-like node to self-match when archivedMode is `include`, overriding whatever the
 * active preset would otherwise decide (e.g. Plan/Start's bundled hiding of Archived goals). `exclude`
 * needs no handling here — it hard-hides the whole subtree earlier, in `typeHardHidden`. */
function withArchivedOverride(node: MindmapNode, f: FilterState, base: boolean): boolean {
  if (f.archivedMode === "include" && isArchived(node)) return true;
  return base;
}

/** Whether a node's own status satisfies the active mode. */
function passesStatus(node: MindmapNode, f: FilterState): boolean {
  // In any filtered mode, structural containers never match on their own — they show only when they
  // hold a content match (so empty/fully-resolved containers drop out). Exception: in Plan, an active
  // aspect/domain/project shows on its own — planning may mean adding items to an empty one. (Resolved
  // ones, and tags, stay ancestor-only.)
  if (f.statusMode !== "all" && STRUCTURAL_KINDS.has(node.kind)) {
    if (f.statusMode === "plan" && node.kind !== "tag") {
      return withArchivedOverride(node, f, !RESOLVED_GOAL.has(node.status ?? ""));
    }
    return false;
  }
  switch (f.statusMode) {
    case "all":
      // archivedMode `exclude` hides an archived/lapsed item under All too, but that's handled by
      // the hard-hide in typeHardHidden (run before this); `include` is a no-op since All already
      // shows everything.
      return true;
    case "plan":
      if (node.kind === "task") return withArchivedOverride(node, f, node.status !== "done");
      if (node.kind === "goal") return withArchivedOverride(node, f, !RESOLVED_GOAL.has(node.status ?? ""));
      return true;
    case "start": {
      if (node.kind !== "task" && node.kind !== "goal") return true;
      // Start = things you can begin now: drop anything whose window has passed. (Blocked
      // task/goals are dropped earlier, as a hard-hidden subtree — see typeHardHidden.)
      if (node.timing === "lapsed") return withArchivedOverride(node, f, false);
      if (node.kind === "goal") return withArchivedOverride(node, f, !RESOLVED_GOAL.has(node.status ?? ""));
      if (node.status === "done") return false;
      // An in-progress task with nothing left to start (no direct todo child) drops out.
      if (node.status === "in_progress" && !node.children.some((c) => c.kind === "task" && c.status === "todo")) {
        return false;
      }
      return true;
    }
    case "do":
      // Only in-progress tasks match; goals/structure appear solely as ancestors. archivedMode does
      // not apply here — Do's "in-progress tasks only" invariant isn't about archived/lapsed status.
      return node.kind === "task" && node.status === "in_progress";
  }
}

/** Combined tag predicate per SPEC: (∪Any) ∧ (∩All) ∧ ¬(∪Exclude). Only judges taggable nodes. */
export function passesTags(node: MindmapNode, f: FilterState): boolean {
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
 * Prunes `root` to the active filter: a node is kept if it matches or has a kept **content** descendant
 * (info nodes are attachments — they ride along with a kept node but never keep it, so an achieved goal
 * whose only children are notes is still hidden). Type/flow-hidden subtrees are dropped outright. The
 * root is always returned as a container (possibly empty) so the canvas has something to render.
 */
export function filterTree(root: MindmapNode, f: FilterState): MindmapNode {
  function prune(node: MindmapNode): MindmapNode | null {
    if (typeHardHidden(node, f)) return null;
    const children: MindmapNode[] = [];
    let hasContentMatch = false;
    for (const child of node.children) {
      const pruned = prune(child);
      if (pruned === null) continue;
      children.push(pruned);
      if (child.kind !== "info") hasContentMatch = true;
    }
    // Info is carried by its parent's decision (visibility already handled by typeHardHidden above).
    if (node.kind === "info") return { ...node, children };
    if (selfMatches(node, f) || hasContentMatch) return { ...node, children };
    return null;
  }
  return prune(root) ?? { ...root, children: [] };
}
