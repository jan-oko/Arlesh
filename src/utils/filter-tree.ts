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
 * The status preset the **Zen View** always reads under — what is in progress — on the Plan View's
 * terms: read, never written into the tab's filter.
 */
export const ZEN_VIEW_STATUS_MODE: StatusMode = "do";

/**
 * How the Plan preset's scope narrowing matches a Task's window: `contained` (the default) keeps a
 * Task whose effective Time Scope lies wholly inside the scope, `overlapping` one whose window
 * shares any instant with it. Mirrors the Rust `ScopeMatch`.
 */
export type ScopeMatch = "contained" | "overlapping";

/** How a single tag filter contributes to the combined tag predicate (SPEC Filtering Logic). */
export type TagFilterMode = "any" | "all" | "exclude";

/** A tri-state pill's override, on top of whatever the status preset would otherwise decide.
 * `inactive` defers entirely to the preset; `include` shows; `exclude` force-hides, gating the
 * whole subtree. Shared by the Archived, Backlog and Delegated pills. */
export type OverrideMode = "inactive" | "include" | "exclude";

/** Override for Archived-status/scope-Lapsed nodes. */
export type ArchivedMode = OverrideMode;

/** Override for backlogged Tasks. */
export type BacklogMode = OverrideMode;

/** Override for delegated Tasks. */
export type DelegatedMode = OverrideMode;

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
  /**
   * The **Delegated** pill (Task 269): off drops a delegated Task under Plan and Start, `include`
   * keeps it there, `exclude` hides it with its subtree under every preset. Absent reads as off — a
   * tab saved before the pill existed. Mirrors `BoardFilter::delegated`.
   */
  delegatedMode?: DelegatedMode;
  /** The Plan preset's scope narrowing: under Plan, a Task shows only when its effective Time
   * Scope matches this scope. `null` narrows nothing. Persisted with the tab. */
  planScope: ScopeKey | null;
  /**
   * How `planScope` matches. **Not persisted with the tab**: it is an app-wide preference, and the
   * views fill it in from that (see `use-board-filter`). Absent reads as `contained`.
   */
  scopeMatch?: ScopeMatch;
  /**
   * Whether **Start** hides a pending wait that has a Check every, showing only the check task
   * beneath it. **Not persisted with the tab**: an app-wide setting, filled in by the views (see
   * `use-board-filter`). Absent reads as off — Start then shows the wait, checked on or not.
   */
  startHidesCheckedWaits?: boolean;
  /**
   * Whether **Start** shows a **Started** Task. **Not persisted with the tab**: an app-wide setting,
   * filled in by the views (see `use-board-filter`). Absent reads as **on**.
   */
  startShowsStarted?: boolean;
  /**
   * Whether **Do** shows a **Started** Task beside the In Progress ones. **Not persisted with the
   * tab**: an app-wide setting, filled in by the views; the Zen View puts its own there. Absent
   * reads as **off**.
   */
  doShowsStarted?: boolean;
  /**
   * Whether **Start**, **Do** and the Zen View show an Agentic Task that is **On Agent** — held by an
   * agent, so not the user's to begin or work on. Off by default; the Filter menu's **On Agent** pill
   * (key `o`) turns it on, and while it is on the Filter button wears its dot. Kept with the tab.
   * Absent reads as off. Mirrors `BoardFilter::show_on_agent`.
   */
  showOnAgent?: boolean;
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
  delegatedMode: "inactive",
  planScope: null,
};

/** Goal statuses that read as resolved/inactive (hidden by Plan/Start). */
const RESOLVED_GOAL = new Set(["achieved", "frozen", "archived"]);

/** Project statuses that shelve the whole subtree in Plan/Start: the work is deliberately off the
 * table, so unresolved items inside it are neither plannable nor startable. **Achieved** is
 * deliberately absent — finished work can still hold unfinished items worth surfacing. */
const SHELVED_PROJECT = new Set(["frozen", "archived"]);

const FLOW_KINDS = new Set(["flow", "flow_goal", "flow_task", "flow_commitment", "flow_expectation"]);
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

/** A Task held by someone else — a Person. Its own pill decides where it shows; it is not archival. */
export function isDelegated(node: MindmapNode): boolean {
  return node.kind === "task" && node.delegate !== undefined && node.delegate !== null;
}

/** The Delegated pill's mode, a tab saved before the pill existed reading as off. */
export function delegatedModeOf(f: FilterState): DelegatedMode {
  return f.delegatedMode ?? "inactive";
}

/**
 * Whether the **Delegated** pill, left off, drops a delegated Task's own match: under Plan and Start
 * — someone else holds it, so it is neither yours to plan nor to start. All, Do and Backlog leave it
 * alone. `include` keeps it, judged by the preset's other rules; `exclude` hides it with its subtree
 * under every preset, in `typeHardHidden`. What it waits on — its delegation wait — answers the
 * Expectation rules. Mirrors `is_dropped_for_delegation` in `src-tauri/src/filters/rules.rs`.
 */
export function isDroppedForDelegation(node: MindmapNode, f: FilterState): boolean {
  if (!isDelegated(node) || delegatedModeOf(f) !== "inactive") return false;
  return f.statusMode === "plan" || f.statusMode === "start";
}

/** An Archived-status node, or one whose effective Archival was derived as archived (a scope
 * Resolution of Completed or Missed forces this, regardless of done-ness — SPEC treats both as
 * "archived-looking", same status-row icon, and the archivedMode filter governs both together). A
 * hand archive — a Task's or Commitment's own, inherited by everything beneath it — arrives the same
 * way, on the backend's lifecycle. A delegated Task is not archived: it has a pill of its own. */
export function isArchived(node: MindmapNode): boolean {
  return node.status === "archived" || node.archived === true;
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
 * Whether `node` is a wait whose window has not begun, which **Start** hides together with the check
 * tasks beneath it. Start hides what is not in scope yet exactly as it hides what has left it (ruled by
 * the user, 2026-09-27); a wait's Timing reads `pending` before its own window opens or, with none of
 * its own, while the window of what it hangs under has not begun.
 *
 * It **gates** the subtree, unlike a Task's rule: a wait's children are its notes and check tasks, and a
 * check is timed by the day it fell due, not by the wait's window — a wait checked on weekly from today
 * has a check due today whatever its window says. Failing the wait alone would leave that check on
 * screen holding the wait as its ancestor. The check schedule is untouched: every other preset still
 * shows the check. The Archived pill's Include still wins for an archived wait. Mirrors
 * `is_unopened_wait` in `src-tauri/src/filters/rules.rs`.
 */
export function isUnopenedWait(node: MindmapNode, f: FilterState): boolean {
  if (f.statusMode !== "start" || node.kind !== "expectation") return false;
  if (node.timing !== "pending") return false;
  return !(f.archivedMode === "include" && isArchived(node));
}

/**
 * Whether **Start** reads a node's window as open: neither still ahead nor passed — or passed, but the
 * node is **Overdue**. An unscoped node, or one with no derived lifecycle, is always in its window.
 *
 * Start shows Overdue items (ruled by the user, 2026-09-30): late work is exactly what should be begun
 * now. The flag is never set on a finished or effectively Archived (Missed) item, and every other reason
 * to drop out — blocked, backlogged, delegated, a Plan still ahead — is judged on its own. Mirrors
 * `is_startable_window` in `src-tauri/src/filters/rules.rs`.
 */
export function isStartableWindow(node: MindmapNode): boolean {
  if (node.overdue === true) return true;
  return node.timing !== "pending" && node.timing !== "lapsed";
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

/**
 * Under **Start**, what the blocked ancestors above a node still let through beneath them:
 * `undefined` while no blocked ancestor stands over it, otherwise the ids it may still show.
 *
 * A blocked Task or Goal gates its subtree — it stands in the way of everything under it — **except
 * its child dependencies**: a descendant it depends on and has not had met is the work that unblocks
 * it, so the block does not hide it, and that descendant's own subtree comes with it (ruled by the
 * user, 2026-10-01: "a block from a child dependency does not hide that dependency"). Whatever else
 * blocks it — an explicit reason, a dependency outside its subtree — still hides everything else.
 * Mirrors `BlockGate` in `src-tauri/src/filters/rules.rs`.
 */
export type BlockGate = ReadonlySet<string> | undefined;

/** Whether `gate` lets `node` through: no gate stands over it, or the gate names it. */
export function isAdmittedBy(node: MindmapNode, gate: BlockGate): boolean {
  return gate === undefined || gate.has(node.id);
}

/**
 * The gate `node`'s children sit under, given the gate `node` itself sits under. A node the gate
 * admits lifts it for its whole subtree; a blocked node closes one of its own naming only its unmet
 * dependencies, narrowed to what an outer gate also names while that outer gate still holds it.
 * Outside Start nothing is gated. Mirrors `gate_below`.
 */
export function gateBelow(node: MindmapNode, gate: BlockGate, f: FilterState): BlockGate {
  return f.statusMode === "start" ? startGateBelow(gate, node) : undefined;
}

/** {@link gateBelow} as Start reads it, with no filter to ask — what the List View folds down a row's
 * chain once, when it builds the row. Argument order suits `reduce`. */
export function startGateBelow(gate: BlockGate, node: MindmapNode): BlockGate {
  const inherited = isAdmittedBy(node, gate) ? undefined : gate;
  if (!isNodeBlocked(node)) return inherited;
  const own = node.blockingDependencyIds ?? [];
  return new Set(inherited === undefined ? own : own.filter((id) => inherited.has(id)));
}

/** Whether Start holds `node` back for a block: blocked itself, or not admitted by a blocked
 * ancestor's gate. It never matches on its own account, but may still stand as the ancestor of a
 * child dependency its block lets through. Mirrors `is_held_by_block`. */
export function isHeldByBlock(node: MindmapNode, gate: BlockGate, f: FilterState): boolean {
  return f.statusMode === "start" && (isNodeBlocked(node) || !isAdmittedBy(node, gate));
}

/** Kinds hidden outright (their subtree is removed, not kept as an ancestor). */
export function typeHardHidden(node: MindmapNode, f: FilterState): boolean {
  // Outside Private Mode, a private node and everything beneath it are dropped, regardless of kind.
  if (!f.privateMode && node.isPrivate === true) return true;
  if (node.kind === "info" && !f.showInfo) return true;
  // archivedMode Exclude gates the whole subtree, same as blocked/private above — otherwise an excluded
  // Habit-instance goal with one still-undone (also-excluded) item and one already-`done` item would
  // stay visible anyway, kept as an ancestor of that unrelated, ordinarily-visible done sibling.
  if (f.archivedMode === "exclude" && isArchived(node)) return true;
  // A backlogged Task gates its subtree the same way a shelved Project does — the work is
  // deliberately not on the table, so nothing under it is plannable or startable either.
  if (isHiddenBacklog(node, f)) return true;
  // The Delegated pill's Exclude gates the subtree too, under every preset, Do included.
  if (delegatedModeOf(f) === "exclude" && isDelegated(node)) return true;
  // A Frozen/Archived Project gates its subtree the same way: hide it outright rather than keeping it
  // as the ancestor of unresolved work that is, by its status, not on the table.
  if (isShelvedProject(node, f)) return true;
  // A habit occurrence whose window has not opened: hidden by every preset but All, subtree and all.
  if (isUnopenedOccurrence(node, f)) return true;
  // Under Start, a wait whose window has not begun: its check tasks go with it.
  if (isUnopenedWait(node, f)) return true;
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
      if (node.kind === "task") {
        return !isDroppedForDelegation(node, f)
          && withArchivedOverride(node, f, node.status !== "done" && !isArchived(node));
      }
      if (node.kind === "goal") {
        return withArchivedOverride(node, f, !RESOLVED_GOAL.has(node.status ?? "") && node.archived !== true);
      }
      return true;
    case "start": {
      if (node.kind !== "task" && node.kind !== "goal") return true;
      // Start = things you can begin now: drop anything whose window has passed or has not begun —
      // except an Overdue item, whose passed window is exactly why it should be begun now.
      // (Blocked task/goals, and what their blocks hold back, are judged by the walk — see
      // isHeldByBlock.) A
      // window still ahead fails only the node's own match, as a lapsed one and a Plan still ahead do:
      // a child with no window of its own reads its parent's and drops too, while one whose own window
      // is open still shows, holding its parent as an ancestor.
      // A delegated Task drops out, Overdue or not, while the Delegated pill is off: nothing someone
      // else holds is yours to start.
      if (isDroppedForDelegation(node, f)) return false;
      if (!isStartableWindow(node)) return withArchivedOverride(node, f, false);
      if (node.kind === "goal") return withArchivedOverride(node, f, !RESOLVED_GOAL.has(node.status ?? ""));
      return passesStartStatus(node, f);
    }
    case "do":
      // Only in-progress tasks match (and Started ones, by the setting); goals/structure appear
      // solely as ancestors. archivedMode does not apply here — Do's "in-progress tasks only"
      // invariant isn't about archived/lapsed status.
      return node.kind === "task" && passesDoStatus(node, f);
    case "backlog":
      // The inverse of every other preset: only what was deliberately set aside, plus everything
      // beneath it. Structural containers already dropped to ancestor-only above.
      return underBacklog || isBacklogged(node);
  }
}

/**
 * Start's rule on a Task's own status: never Done; In Progress only while it still has something
 * to start (a direct To Do child); **Started** by the app-wide setting, on by default — a paused
 * task is something to pick back up. Shared by the Mindmap and the List View; mirrors
 * `passes_start` in `src-tauri/src/filters/rules.rs`.
 */
export function passesStartStatus(node: MindmapNode, f: FilterState): boolean {
  if (node.taskStatus?.kind === "agentic") return passesAgenticStartStatus(node, f);
  if (node.status === "done") return false;
  // An in-progress task with nothing left to start (no direct todo child) drops out.
  if (node.status === "in_progress") return node.children.some((c) => c.kind === "task" && c.status === "todo");
  if (node.status === "started") return f.startShowsStarted !== false;
  return true;
}

/**
 * Start's rule on an **Agentic** Task's status: To Do is there to be claimed; Doing is the user's own
 * work, kept while it still has a To Do child, as In Progress is; **Review** always shows — whatever
 * the Started settings say — since the agent is idle until the user answers; **On Agent** only while
 * `showOnAgent` asks for it; Done never. Mirrors `passes_agentic_start` in `rules.rs`.
 */
function passesAgenticStartStatus(node: MindmapNode, f: FilterState): boolean {
  switch (node.taskStatus?.status) {
    case "todo": return true;
    case "doing": return node.children.some((c) => c.kind === "task" && c.status === "todo");
    case "review": return true;
    case "on_agent": return f.showOnAgent === true;
    default: return false;
  }
}

/**
 * Do's rule on a Task's own status. An ordinary Task: In Progress always, **Started** only while the
 * setting in `doShowsStarted` is on (off by default). An **Agentic** Task: Doing and Review always,
 * On Agent only while `showOnAgent` is on. Mirrors `passes_do_status` in `rules.rs`.
 */
export function passesDoStatus(node: MindmapNode, f: FilterState): boolean {
  const status = node.taskStatus;
  if (status?.kind === "agentic") {
    if (status.status === "doing" || status.status === "review") return true;
    return status.status === "on_agent" && f.showOnAgent === true;
  }
  if (node.status === "in_progress") return true;
  return node.status === "started" && f.doShowsStarted === true;
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
 * shows under **Plan**, and under **Start** while its window is open (neither ahead nor passed), whether or not it is
 * checked on; its check tasks answer the ordinary Task rules beside it. With `startHidesCheckedWaits`
 * on (an app-wide setting, off by default), Start shows one only when it has no Check every — the
 * check task beneath it is then the thing to start. Stored and derived waits alike. **Do** and
 * **Backlog** show none. A released or archived one shows under All only. Mirrors
 * `passes_expectation_preset` in `src-tauri/src/filters/rules.rs`.
 */
export function passesExpectationPreset(node: MindmapNode, f: FilterState): boolean {
  switch (f.statusMode) {
    case "all":
      return true;
    case "plan":
      return isLiveExpectation(node);
    // A wait whose window has passed, or has not begun, drops out of Start, as a Task's does —
    // unless it is Overdue: still pending past its window.
    case "start":
      return isLiveExpectation(node)
        && !(f.startHidesCheckedWaits === true && (node.checkEvery ?? null) !== null)
        && isStartableWindow(node);
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
    gate: BlockGate,
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
    // Under Start a blocked node gates what lies beneath it, letting only its child dependencies
    // through; it and everything it holds back can still stand as the ancestors of those.
    const gateForChildren = gateBelow(node, gate, f);
    const held = isHeldByBlock(node, gate, f);
    const children: MindmapNode[] = [];
    let hasContentMatch = false;
    for (const child of node.children) {
      // A hard-hidden node is on screen only to carry the focused node: nothing else beneath it returns.
      if (hardHidden && !exempt.has(child.id)) continue;
      const pruned = prune(child, inheritedForChildren, backlogForChildren, planForChildren, timeScopeForChildren, gateForChildren);
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
    const matches = !held
      && selfMatches(node, f, inheritedStatus, underBacklog)
      && !isPlannedAhead(node, f, inheritedPlan)
      && !isOutsidePlanScope(node, f, inheritedTimeScope);
    if (matches || hasContentMatch) return { ...node, children };
    if (isExempt) {
      exemptedIds.add(node.id);
      return { ...node, children };
    }
    return null;
  }

  return { root: prune(root, UNSET_STATUS, false, undefined, undefined, undefined) ?? { ...root, children: [] }, exemptedIds };
}
