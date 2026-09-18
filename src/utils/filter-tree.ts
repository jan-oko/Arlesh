import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
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
  /** Private Mode: when off (the default), any node marked private is hard-hidden together with
   * its whole subtree; turning it on reveals them. */
  privateMode: boolean;
  /** Override for Archived-status/scope-Lapsed nodes on top of the status preset. */
  archivedMode: ArchivedMode;
}

/** The neutral, indicator-off filter — shows everything except nodes marked private. */
export const DEFAULT_FILTER: FilterState = {
  statusMode: "all",
  modeIncludeFlows: true,
  tagFilters: [],
  showInfo: true,
  showFlow: true,
  privateMode: false,
  archivedMode: "inactive",
};

/** Goal statuses that read as resolved/inactive (hidden by Plan/Start). */
const RESOLVED_GOAL = new Set(["achieved", "frozen", "archived"]);

/** Project statuses that shelve the whole subtree in Plan/Start: the work is deliberately off the
 * table, so unresolved items inside it are neither plannable nor startable. **Achieved** is
 * deliberately absent — finished work can still hold unfinished items worth surfacing. */
const SHELVED_PROJECT = new Set(["frozen", "archived"]);

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

/**
 * Whether `node` is a Project that Plan/Start shelve along with everything inside it. The Mindmap gets
 * the subtree removal from tree-pruning; List View has no tree to prune, so it applies this to each
 * row's ancestors itself (as it already does for blocked/private ancestors).
 */
export function isShelvedProject(node: MindmapNode, f: FilterState): boolean {
  if (node.kind !== "project") return false;
  if (f.statusMode !== "plan" && f.statusMode !== "start") return false;
  if (!SHELVED_PROJECT.has(node.status ?? "")) return false;
  // The Archived pill's Include still wins for the Archived case, as it does everywhere else.
  return !(f.archivedMode === "include" && isArchived(node));
}

/**
 * The kinds this filter hides for *every* node, whatever that node's own state — today the two
 * node-type visibility toggles, Info and Flow.
 *
 * Only a whole-kind rule belongs here. Private Mode, the status preset, the Archived tri-state and
 * the shelved-Project rule all hide a *particular* node on its own privacy, status or blocked-ness,
 * so "would a node of kind K be visible?" has no answer independent of the node. Callers that need
 * to know which kinds are unreachable — the type cycle, which must not convert a node into
 * something the view cannot show — can only act on the whole-kind rules.
 */
export function hiddenNodeKinds(f: FilterState): NodeKind[] {
  const hidden: NodeKind[] = [];
  if (!f.showInfo) hidden.push("info");
  if (!f.showFlow) hidden.push("flow", "flow_goal", "flow_task");
  return hidden;
}

/** Kinds hidden outright (their subtree is removed, not kept as an ancestor). */
export function typeHardHidden(node: MindmapNode, f: FilterState): boolean {
  // Outside Private Mode, a private node and everything beneath it are dropped, regardless of kind.
  if (!f.privateMode && node.isPrivate === true) return true;
  if (node.kind === "info" && !f.showInfo) return true;
  // In Start, a blocked task/goal gates its whole subtree: drop it outright rather than merely
  // failing its self-match, which would otherwise keep it as an ancestor of a startable descendant.
  if (f.statusMode === "start" && isNodeBlocked(node)) return true;
  // archivedMode Exclude gates the whole subtree, same as blocked/private above — otherwise an excluded
  // Habit-instance goal with one still-undone (also-excluded) item and one already-`done` item would
  // stay visible anyway, kept as an ancestor of that unrelated, ordinarily-visible done sibling.
  if (f.archivedMode === "exclude" && isArchived(node)) return true;
  // A Frozen/Archived Project gates its subtree the same way: hide it outright rather than keeping it
  // as the ancestor of unresolved work that is, by its status, not on the table.
  if (isShelvedProject(node, f)) return true;
  return flowHardHidden(node, f);
}

/** Forces an archived-like node to self-match when archivedMode is `include`, overriding whatever the
 * active preset would otherwise decide (e.g. Plan/Start's bundled hiding of Archived goals). `exclude`
 * needs no handling here — it hard-hides the whole subtree earlier, in `typeHardHidden`. Shared with
 * List View's own preset predicate so both surfaces read `archived` the same way. */
export function withArchivedOverride(node: MindmapNode, f: FilterState, base: boolean): boolean {
  if (f.archivedMode === "include" && isArchived(node)) return true;
  return base;
}

/** The status a container falls back to when neither it nor any ancestor carries one. */
const UNSET_STATUS = "active";

/**
 * Whether a node's own status satisfies the active mode. `inheritedStatus` is the nearest
 * status-bearing container ancestor's status, used only for containers of their own: a Domain/Aspect
 * can never be given a status (only a Project can), so judging one on its own status alone made every
 * Domain read as unresolved — keeping an achieved Project visible in Plan as their ancestor.
 */
function passesStatus(node: MindmapNode, f: FilterState, inheritedStatus: string): boolean {
  // In any filtered mode, structural containers never match on their own — they show only when they
  // hold a content match (so empty/fully-resolved containers drop out). Exception: in Plan, an active
  // aspect/domain/project shows on its own — planning may mean adding items to an empty one. (Resolved
  // ones, and tags, stay ancestor-only.)
  if (f.statusMode !== "all" && STRUCTURAL_KINDS.has(node.kind)) {
    if (f.statusMode === "plan" && node.kind !== "tag") {
      return withArchivedOverride(node, f, !RESOLVED_GOAL.has(node.status ?? inheritedStatus));
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
      // Plan also hides anything effectively archived — not just a goal/project whose stored status
      // is itself achieved/frozen/archived (RESOLVED_GOAL), but any scoped item a forced Resolution
      // archived regardless of its stored status (e.g. a still-"active" goal, or any task, which has
      // no stored status of its own to catch this).
      if (node.kind === "task") return withArchivedOverride(node, f, node.status !== "done" && node.archived !== true);
      if (node.kind === "goal") {
        return withArchivedOverride(node, f, !RESOLVED_GOAL.has(node.status ?? "") && node.archived !== true);
      }
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

function selfMatches(node: MindmapNode, f: FilterState, inheritedStatus: string): boolean {
  return passesStatus(node, f, inheritedStatus) && passesTags(node, f);
}

/**
 * Prunes `root` to the active filter: a node is kept if it matches or has a kept **content** descendant
 * (info nodes are attachments — they ride along with a kept node but never keep it, so an achieved goal
 * whose only children are notes is still hidden). Type/flow-hidden subtrees are dropped outright. The
 * root is always returned as a container (possibly empty) so the canvas has something to render.
 */
export function filterTree(root: MindmapNode, f: FilterState): MindmapNode {
  function prune(node: MindmapNode, inheritedStatus: string): MindmapNode | null {
    if (typeHardHidden(node, f)) return null;
    // Only containers pass a status down — a Goal/Task always carries its own, and no container ever
    // sits beneath one, so their statuses must not leak into the chain.
    const inheritedForChildren = STRUCTURAL_KINDS.has(node.kind)
      ? node.status ?? inheritedStatus
      : inheritedStatus;
    const children: MindmapNode[] = [];
    let hasContentMatch = false;
    for (const child of node.children) {
      const pruned = prune(child, inheritedForChildren);
      if (pruned === null) continue;
      children.push(pruned);
      if (child.kind !== "info") hasContentMatch = true;
    }
    // Info is carried by its parent's decision (visibility already handled by typeHardHidden above).
    if (node.kind === "info") return { ...node, children };
    if (selfMatches(node, f, inheritedStatus) || hasContentMatch) return { ...node, children };
    return null;
  }
  return prune(root, UNSET_STATUS) ?? { ...root, children: [] };
}
