import type { MindmapNode } from "@/utils/tree-layout";
import { isOccurrence } from "@/utils/node-identity";
import { isNodeBlocked } from "@/utils/tree-layout";
import { VERDICT } from "@/api/verdict";
import { EXPECTATION_STATUS } from "@/api/expectation-status";
import type { Timing } from "@/api/scope-lifecycle";
import type { ScopeKey } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import { intervalContains, intervalsOverlap } from "@/utils/scope-interval";
import { keyWindow, timeScopeWindowOf } from "@/utils/scope-window";

/** Status preset a filter is in. `all` disables status filtering; `backlog` inverts it, showing
 * only what has been deliberately set aside. */
export type StatusMode = "all" | "plan" | "start" | "do" | "backlog";

/**
 * The status preset the **Plan View** always reads under, whatever the tab's own is. The view reads
 * the board *as* Plan rather than writing Plan into the tab's filter, so the tab's own preset is
 * still there — and back in force — the moment you switch to another view.
 */
export const PLAN_VIEW_STATUS_MODE: StatusMode = "plan";

/**
 * How the Plan preset's scope narrowing matches a Task's window: `contained` (the default) keeps a
 * Task whose effective Time Scope lies wholly inside the scope, `overlapping` one whose window
 * shares any instant with it. Mirrors the Rust `ScopeMatch`.
 */
export type ScopeMatch = "contained" | "overlapping";

/** How a single tag filter contributes to the combined tag predicate (SPEC Filtering Logic). */
export type TagFilterMode = "any" | "all" | "exclude";

/** A tri-state pill's override, on top of whatever the status preset would otherwise decide.
 * `inactive` defers entirely to the preset; `include` force-shows; `exclude` force-hides, gating
 * the whole subtree. Shared by the Archived and Backlog pills, which behave identically. */
export type OverrideMode = "inactive" | "include" | "exclude";

/** Override for Archived-status/scope-Lapsed nodes. */
export type ArchivedMode = OverrideMode;

/** Override for backlogged Tasks. */
export type BacklogMode = OverrideMode;

/** The mode a tri-state pill advances to when clicked (Inactive → Include → Exclude → Inactive). */
export const NEXT_OVERRIDE_MODE: Record<OverrideMode, OverrideMode> = {
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
  /** Override for backlogged Tasks on top of the status preset — the Archived pill's twin. */
  backlogMode: BacklogMode;
  /** The Plan preset's scope narrowing: under Plan, a Task shows only when its effective Time
   * Scope matches this scope. `null` narrows nothing. Persisted with the tab. */
  planScope: ScopeKey | null;
  /**
   * How `planScope` matches. **Not persisted with the tab**: it is an app-wide preference, and the
   * views fill it in from that (see `use-board-filter`). Absent reads as `contained`.
   */
  scopeMatch?: ScopeMatch;
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
  backlogMode: "inactive",
  planScope: null,
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

/** A Task held by someone else — a Person or the Agent. It has every effect of archival. */
export function isDelegated(node: MindmapNode): boolean {
  return node.kind === "task" && node.delegate !== undefined && node.delegate !== null;
}

/** An Archived-status node, one whose effective Archival was derived as archived (a scope
 * Resolution of Completed or Missed forces this, regardless of done-ness — SPEC treats both as
 * "archived-looking", same status-row icon, and the archivedMode filter governs both together), or
 * a delegated Task: someone else holds it, so it is off your board wherever an archived node is.
 * What it waits on stays visible — its virtual Expectation answers the Expectation rules. */
export function isArchived(node: MindmapNode): boolean {
  return node.status === "archived" || node.archived === true || isDelegated(node);
}

/** A Task the user deliberately set aside. Read off the node's own stored flag, not the derived
 * Archival, so a backlogged task whose window has since lapsed still reads as backlogged (it also
 * reads as archived — the two badges are both true, exactly as they are for a Frozen goal). */
function isBacklogged(node: MindmapNode): boolean {
  return node.backlogged === true;
}

/**
 * Whether `node` is a backlogged Task that the active filter hides along with everything beneath
 * it. Setting a piece of work aside sets its sub-steps aside too, so it is dropped as a unit
 * rather than kept on screen as the ancestor of live children.
 *
 * Plan and Start hide it; All and Do leave it alone; Backlog is the preset that exists to show it.
 * The pill overrides all of that: `include` force-shows it under Plan/Start, `exclude` hides it
 * everywhere, even under All.
 *
 * **Do is deliberate.** Backlog says *not planning this now* and Do asks *what is underway* —
 * different questions a Task can answer yes to at once — so a backlogged in-progress Task still
 * shows there. The tension is resolved where it starts instead: setting a Task In Progress takes it
 * out of the Backlog (see `docs/spec/resources.md`), so the pair is rare rather than hidden.
 */
export function isHiddenBacklog(node: MindmapNode, f: FilterState): boolean {
  if (!isBacklogged(node)) return false;
  if (f.backlogMode === "exclude") return true;
  if (f.backlogMode === "include") return false;
  return f.statusMode === "plan" || f.statusMode === "start";
}

/**
 * Whether `node` is a **habit occurrence** whose window has not opened yet and the active preset
 * therefore hides, together with everything beneath it.
 *
 * This is the Archived shape, not the Archived rule: the backend produces the occurrence and says
 * where its window stands, and the preset decides. **All shows it** — that is All's whole contract,
 * and a habit's later-today items are exactly what you look at All to see. **Every other preset
 * hides it**, Backlog included: a daily routine would otherwise put its whole day's occurrences
 * into every one of them at breakfast, and an unopened window is not work that was set aside.
 *
 * Restricted to occurrences (`habitItem`) on purpose. `Pending` is derived for **any** scoped item
 * whose window is still ahead, and a real task scheduled for next week has always shown under Plan
 * — that is what planning is. Nothing here changes that; the rule is about the occurrences a Habit
 * generates in bulk, which is where it was asked for.
 *
 * It gates the subtree rather than merely failing its own match, because children nest under their
 * parent's first occurrence — keeping an unopened parent on screen as the ancestor of a child whose
 * own window *has* opened would draw a row nobody asked for under a preset that just said it did
 * not want it.
 *
 * Deliberately not routed through the Archived pill: an unopened window is not archived, has no
 * Resolution, and the pill that force-shows what has finished should not force-show what has not
 * started.
 */
export function isUnopenedOccurrence(node: MindmapNode, f: FilterState): boolean {
  if (!isOccurrence(node) || node.timing !== "pending") return false;
  return f.statusMode !== "all";
}

/**
 * Whether `node` is a Task that **Start** hides because its Plan has not begun yet — Start asks what
 * can be begun *now*, and a Task scheduled into next week is not that.
 *
 * The Plan read is the Task's own `planTiming` when it has one, and otherwise `inheritedPlan`: the
 * nearest planned ancestor Task's, which the walk carries down. That inheritance is the **interim**
 * reading of an unplanned sub-step under a planned Task, pending real Plan inheritance, and lives
 * only here — nothing stored, edited or badged inherits a Plan yet. A Task with a Plan of its own
 * answers to it alone, whatever its parent's says.
 *
 * Only a Plan still **ahead** hides: one that ended unfulfilled keeps the Task on screen as missed
 * work. It fails the Task's own match rather than gating its subtree, so a sub-step with a current
 * Plan still shows, holding its future-planned parent on screen as an ancestor. Virtual Habit
 * occurrences carry no `planTiming`, so their Cycle Plans are not read. Mirrors `is_planned_ahead`
 * in `src-tauri/src/filters/rules.rs`.
 */
export function isPlannedAhead(node: MindmapNode, f: FilterState, inheritedPlan: Timing | undefined): boolean {
  if (f.statusMode !== "start" || node.kind !== "task") return false;
  return (node.planTiming ?? inheritedPlan) === "pending";
}

/**
 * Whether `node` is a Task the Plan preset's **scope narrowing** leaves out.
 *
 * With `planScope` set under Plan, a Task shows only when its **effective** Time Scope — its own,
 * or `inheritedTimeScope`, the nearest scoped ancestor's, which the walk carries down — matches the
 * scope: wholly inside it under `contained` (the default), sharing any instant with it under
 * `overlapping`. An **Unscoped** Task is inside nothing, so containment leaves it out; overlap keeps
 * it, since the model defines Unscoped as always relevant.
 *
 * Only a Task is narrowed. It fails the Task's own match rather than gating its subtree, so a
 * sub-step inside the scope still holds a wider parent on screen as its ancestor. Mirrors
 * `is_outside_plan_scope` in `src-tauri/src/filters/rules.rs`.
 */
export function isOutsidePlanScope(node: MindmapNode, f: FilterState, inheritedTimeScope: TimeScope | undefined): boolean {
  if (f.statusMode !== "plan" || f.planScope === null || node.kind !== "task") return false;
  const match = f.scopeMatch ?? "contained";
  const scope = node.timeScope ?? inheritedTimeScope;
  if (scope === undefined) return match === "contained";
  const target = keyWindow(f.planScope);
  const window = timeScopeWindowOf(scope);
  return match === "contained" ? !intervalContains(target, window) : !intervalsOverlap(target, window);
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
  // A backlogged Task gates its subtree the same way a shelved Project does — the work is
  // deliberately not on the table, so nothing under it is plannable or startable either.
  if (isHiddenBacklog(node, f)) return true;
  // A Frozen/Archived Project gates its subtree the same way: hide it outright rather than keeping it
  // as the ancestor of unresolved work that is, by its status, not on the table.
  if (isShelvedProject(node, f)) return true;
  // A habit occurrence whose window has not opened: hidden by every preset but All, subtree and all.
  if (isUnopenedOccurrence(node, f)) return true;
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
 *
 * `underBacklog` says whether some ancestor is a backlogged Task. It matters only to the Backlog
 * preset, which shows a set-aside Task *and its whole subtree* — the sub-steps go with the step.
 */
function passesStatus(
  node: MindmapNode,
  f: FilterState,
  inheritedStatus: string,
  underBacklog: boolean,
): boolean {
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
  if (node.kind === "commitment") {
    return withArchivedOverride(node, f, passesCommitmentPreset(node, f));
  }
  if (node.kind === "expectation") {
    return withArchivedOverride(node, f, passesExpectationPreset(node, f));
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
      if (node.kind === "task") return withArchivedOverride(node, f, node.status !== "done" && !isArchived(node));
      if (node.kind === "goal") {
        return withArchivedOverride(node, f, !RESOLVED_GOAL.has(node.status ?? "") && node.archived !== true);
      }
      return true;
    case "start": {
      if (node.kind !== "task" && node.kind !== "goal") return true;
      // Start = things you can begin now: drop anything whose window has passed. (Blocked
      // task/goals are dropped earlier, as a hard-hidden subtree — see typeHardHidden.)
      // A delegated Task drops out with the lapsed ones: nothing someone else holds is yours to start.
      if (node.timing === "lapsed" || isDelegated(node)) return withArchivedOverride(node, f, false);
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
    case "backlog":
      // The inverse of every other preset: only what was deliberately set aside, plus everything
      // beneath it. Structural containers already dropped to ancestor-only above.
      return underBacklog || isBacklogged(node);
  }
}

/**
 * Whether a Commitment shows under the given preset.
 *
 * Its own rule, not a translation of a Task's, because the two kinds resolve the opposite way
 * round. Three presets — Plan, Start and Do — show what is **unresolved**: what you have yet to
 * judge is what is still live, and a recorded verdict, Kept or Broken alike, is answered the way a
 * done Task is. All shows everything, including past verdicts, because looking back over what you
 * kept and broke is the point of keeping the record. (Plan once kept a Broken commitment on screen
 * while its window was open; the user ruled that out on 2026-09-23.)
 *
 * Backlog shows none: a Commitment has no Backlog state to be in.
 */
export function passesCommitmentPreset(node: MindmapNode, f: FilterState): boolean {
  const verdict = node.verdict ?? VERDICT.UNRESOLVED;
  switch (f.statusMode) {
    case "all":
      return true;
    case "plan":
    case "start":
    case "do":
      return verdict === VERDICT.UNRESOLVED;
    case "backlog":
      return false;
  }
}

/** Whether an Expectation is still waited on and not put away: pending, and not archived. */
export function isLiveExpectation(node: MindmapNode): boolean {
  return node.status === EXPECTATION_STATUS.PENDING && node.archived !== true;
}

/**
 * Whether an Expectation shows under the given preset.
 *
 * A wait is not work, so it answers its own rule. **All** shows every one. A pending, live one
 * shows under **Plan**, and under **Start** only when it is not checked on (no Check every) — with
 * a Check every, the virtual check task beneath it is the thing to start, and that task answers the ordinary Task rules. **Do**
 * and **Backlog** show none. A released or archived one shows under All only.
 */
export function passesExpectationPreset(node: MindmapNode, f: FilterState): boolean {
  switch (f.statusMode) {
    case "all":
      return true;
    case "plan":
      return isLiveExpectation(node);
    // A wait whose own window has passed drops out of Start, as a Task's does.
    case "start":
      return isLiveExpectation(node) && (node.checkEvery ?? null) === null && node.timing !== "lapsed";
    case "do":
    case "backlog":
      return false;
  }
}

/** Combined tag predicate per SPEC: (∪Any) ∧ (∩All) ∧ ¬(∪Exclude). Only judges taggable nodes. */
export function passesTags(node: MindmapNode, f: FilterState): boolean {
  if (f.tagFilters.length === 0) return true;
  if (node.kind !== "task" && node.kind !== "goal" && node.kind !== "commitment" && node.kind !== "expectation") {
    return true;
  }
  const has = (id: number) => node.tagIds.includes(id);
  const any = f.tagFilters.filter((t) => t.mode === "any");
  if (any.length > 0 && !any.some((t) => has(t.tagId))) return false;
  if (!f.tagFilters.filter((t) => t.mode === "all").every((t) => has(t.tagId))) return false;
  if (f.tagFilters.filter((t) => t.mode === "exclude").some((t) => has(t.tagId))) return false;
  return true;
}

function selfMatches(
  node: MindmapNode,
  f: FilterState,
  inheritedStatus: string,
  underBacklog: boolean,
): boolean {
  return passesStatus(node, f, inheritedStatus, underBacklog) && passesTags(node, f);
}

/** A pruned tree plus the ids that survived it **only** because they were focus-exempt — the nodes
 * the filter itself would have dropped, which the views render dimmed. */
export interface FocusFilteredTree {
  root: MindmapNode;
  exemptedIds: ReadonlySet<string>;
}

/**
 * Prunes `root` to the active filter: a node is kept if it matches or has a kept **content** descendant
 * (info nodes are attachments — they ride along with a kept node but never keep it, so an achieved goal
 * whose only children are notes is still hidden). Type/flow-hidden subtrees are dropped outright. The
 * root is always returned as a container (possibly empty) so the canvas has something to render.
 */
export function filterTree(root: MindmapNode, f: FilterState): MindmapNode {
  return pruneTree(root, f, new Set<string>()).root;
}

/**
 * The same pruning, with the **focus exemption** applied: every id in `exempt` — the focused node and
 * the ancestor chain that reaches it — renders whatever the filter says about it, overriding every
 * hiding rule, hard-hidden subtrees included. It is a render-time exemption only: `filterTree` and
 * every other caller of the filter still get the unexempted answer, so nothing that counts, filters
 * or exports sees the extra node.
 *
 * The exemption carries nothing but that chain. A node held on screen by it shows only the children
 * the filter already kept plus the chain itself, so revealing (say) a private Project as an ancestor
 * never spills the rest of its subtree into the view.
 */
export function filterTreeWithFocus(root: MindmapNode, f: FilterState, exempt: ReadonlySet<string>): FocusFilteredTree {
  return pruneTree(root, f, exempt);
}

function pruneTree(root: MindmapNode, f: FilterState, exempt: ReadonlySet<string>): FocusFilteredTree {
  const exemptedIds = new Set<string>();

  function prune(
    node: MindmapNode,
    inheritedStatus: string,
    underBacklog: boolean,
    inheritedPlan: Timing | undefined,
    inheritedTimeScope: TimeScope | undefined,
  ): MindmapNode | null {
    const isExempt = exempt.has(node.id);
    const hardHidden = typeHardHidden(node, f);
    if (hardHidden && !isExempt) return null;
    // Only containers pass a status down — a Goal/Task always carries its own, and no container ever
    // sits beneath one, so their statuses must not leak into the chain.
    const inheritedForChildren = STRUCTURAL_KINDS.has(node.kind)
      ? node.status ?? inheritedStatus
      : inheritedStatus;
    // Backlog, unlike status, does propagate: everything under a set-aside Task is set aside too.
    const backlogForChildren = underBacklog || isBacklogged(node);
    // So, for Start, does a Plan: an unplanned sub-step is read by its nearest planned ancestor's.
    // A wait cuts the chain: the check task beneath it has no Plan, answers to its own due time,
    // and must not vanish because the Task the wait hangs under is planned for next week.
    const planForChildren = node.kind === "expectation" ? undefined : node.planTiming ?? inheritedPlan;
    // A Time Scope is inherited from the nearest scoped ancestor, as it is everywhere else.
    const timeScopeForChildren = node.timeScope ?? inheritedTimeScope;
    const children: MindmapNode[] = [];
    let hasContentMatch = false;
    for (const child of node.children) {
      // A hard-hidden node is on screen only to carry the focused node: nothing else beneath it returns.
      if (hardHidden && !exempt.has(child.id)) continue;
      const pruned = prune(child, inheritedForChildren, backlogForChildren, planForChildren, timeScopeForChildren);
      if (pruned === null) continue;
      children.push(pruned);
      // A child kept only by the exemption is not a match, so it must not keep its parent either —
      // the chain above the focused node is held by the exemption, not by the node it carries.
      if (child.kind !== "info" && !exemptedIds.has(child.id)) hasContentMatch = true;
    }
    if (hardHidden) {
      exemptedIds.add(node.id);
      return { ...node, children };
    }
    // Info is carried by its parent's decision (visibility already handled by typeHardHidden above).
    if (node.kind === "info") return { ...node, children };
    const matches = selfMatches(node, f, inheritedStatus, underBacklog)
      && !isPlannedAhead(node, f, inheritedPlan)
      && !isOutsidePlanScope(node, f, inheritedTimeScope);
    if (matches || hasContentMatch) return { ...node, children };
    if (isExempt) {
      exemptedIds.add(node.id);
      return { ...node, children };
    }
    return null;
  }

  return { root: prune(root, UNSET_STATUS, false, undefined, undefined) ?? { ...root, children: [] }, exemptedIds };
}
