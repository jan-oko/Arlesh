import type { MindmapNode } from "@/utils/tree-layout";
import type { FilterState, TagFilterMode } from "@/utils/filter-tree";
import {
  typeHardHidden, passesTags, withArchivedOverride, isShelvedProject, isHiddenBacklog,
  isUnopenedOccurrence, passesCommitmentPreset, passesExpectationPreset, isArchived, isDelegated,
  isLiveExpectation, isPlannedAhead,
} from "@/utils/filter-tree";
import { TASK_STATUS, GOAL_STATUS, PROJECT_STATUS } from "@/utils/status-mapping";
import type { Verdict } from "@/api/verdict";
import type { Timing } from "@/api/scope-lifecycle";
import { VERDICT, VERDICT_VALUES } from "@/api/verdict";

/** Same any/all/exclude semantics as a tag filter, reused across every List View filter dimension. */
export type PillMode = TagFilterMode;

/** One pill: a value (a node id, a status string, or a fixed scope/blocked token) in a given mode. */
export interface PillFilter {
  value: string;
  mode: PillMode;
}

/** Set-theory glyphs: Any = union, All = intersection, Exclude = empty set — shown on every pill/chip. */
export const PILL_MODE_SYMBOL: Record<PillMode, string> = { any: "∪", all: "∩", exclude: "∅" };

/** The mode a pill advances to when its chip is clicked (Any → All → Exclude → Any). */
export const NEXT_PILL_MODE: Record<PillMode, PillMode> = { any: "all", all: "exclude", exclude: "any" };

/**
 * Which way a pill points: it keeps its value **in** or keeps it **out**.
 *
 * `any` and `all` are both "in" — they differ only in how several pills of one dimension combine,
 * not in whether the value is wanted — and `exclude` is the one that reverses the question. A
 * gesture that says "filter to this" or "filter this out" names a side, not a mode, so the code
 * that answers such a gesture can leave an `all` the user set on a chip exactly where it is.
 */
export type PillSide = "include" | "exclude";

/** The side a mode puts its value on. */
export function pillSide(mode: PillMode): PillSide {
  return mode === "exclude" ? "exclude" : "include";
}

/** The List-View-exclusive filter dimensions (status preset, tags, and type toggles stay in the shared FilterState). */
export type PillDimension =
  | "antecedent" | "dependency"
  | "taskStatus" | "goalStatus" | "projectStatus" | "verdict"
  | "scopeState" | "blocked" | "agentic" | "asynchronous";

export const PILL_DIMENSIONS: PillDimension[] = [
  "antecedent", "dependency",
  "taskStatus", "goalStatus", "projectStatus", "verdict",
  "scopeState", "blocked", "agentic", "asynchronous",
];

/** List View's own preset selector: All/Plan/Start/Do write through to the shared status preset;
 * Unblock and Expectations are List-View-only and do not touch it (see SPEC List View section). */
export const LIST_PRESET_VALUES = ["all", "plan", "start", "do", "backlog", "unblock", "expectations"] as const;

/** The List-View-only options: each replaces the shared preset's rules for the list, leaving the
 * shared preset where it was for the Mindmap. */
export const LIST_ONLY_PRESETS: readonly ListPreset[] = ["unblock", "expectations"];

/** Whether `preset` is one of the List-View-only options. */
export function isListOnlyPreset(preset: ListPreset): boolean {
  return LIST_ONLY_PRESETS.includes(preset);
}
export type ListPreset = (typeof LIST_PRESET_VALUES)[number];

export function isListPreset(value: string): value is ListPreset {
  return (LIST_PRESET_VALUES as readonly string[]).includes(value);
}

export const TASK_STATUS_VALUES = Object.values(TASK_STATUS);
export const GOAL_STATUS_VALUES = Object.values(GOAL_STATUS);
export const PROJECT_STATUS_VALUES = Object.values(PROJECT_STATUS);
export const VERDICT_FILTER_VALUES = VERDICT_VALUES;
export const SCOPE_STATE_VALUES = ["unscoped", "active", "overdue", "lapsed", "planned", "unplanned"] as const;
export const BLOCKED_VALUES = ["blocked", "not_blocked"] as const;
/** The Agentic dimension's two values. A task reads as one or the other and never neither: an
 * unflagged task under an agentic one is agentic, and every other task is not. */
export const AGENTIC_VALUES = ["agentic", "not_agentic"] as const;
/** The Asynchronous dimension's two values. A task reads as one or the other and never neither:
 * the flag is a plain boolean on the row itself, with no inherited third answer. */
export const ASYNCHRONOUS_VALUES = ["asynchronous", "not_asynchronous"] as const;

export type TaskStatusValue = (typeof TASK_STATUS_VALUES)[number];
export type GoalStatusValue = (typeof GOAL_STATUS_VALUES)[number];
export type ProjectStatusValue = (typeof PROJECT_STATUS_VALUES)[number];
export type ScopeStateValue = (typeof SCOPE_STATE_VALUES)[number];
export type BlockedValue = (typeof BLOCKED_VALUES)[number];
export type AgenticValue = (typeof AGENTIC_VALUES)[number];
export type AsynchronousValue = (typeof ASYNCHRONOUS_VALUES)[number];

export function isTaskStatusValue(value: string): value is TaskStatusValue {
  return (TASK_STATUS_VALUES as readonly string[]).includes(value);
}

export function isGoalStatusValue(value: string): value is GoalStatusValue {
  return (GOAL_STATUS_VALUES as readonly string[]).includes(value);
}

export function isProjectStatusValue(value: string): value is ProjectStatusValue {
  return (PROJECT_STATUS_VALUES as readonly string[]).includes(value);
}

export function isVerdictValue(value: string): value is Verdict {
  return VERDICT_FILTER_VALUES.some((verdict) => verdict === value);
}

export function isScopeStateValue(value: string): value is ScopeStateValue {
  return (SCOPE_STATE_VALUES as readonly string[]).includes(value);
}

export function isBlockedValue(value: string): value is BlockedValue {
  return (BLOCKED_VALUES as readonly string[]).includes(value);
}

export function isAgenticValue(value: string): value is AgenticValue {
  return (AGENTIC_VALUES as readonly string[]).includes(value);
}

export function isAsynchronousValue(value: string): value is AsynchronousValue {
  return (ASYNCHRONOUS_VALUES as readonly string[]).includes(value);
}

export interface ListFilterState {
  preset: ListPreset;
  pills: Record<PillDimension, PillFilter[]>;
}

export const DEFAULT_LIST_FILTER: ListFilterState = {
  preset: "all",
  pills: {
    antecedent: [], dependency: [],
    taskStatus: [], goalStatus: [], projectStatus: [], verdict: [],
    scopeState: [], blocked: [], agentic: [], asynchronous: [],
  },
};

/** True for a persisted pill that still has the shape the filters read. */
function isPillFilter(value: unknown): value is PillFilter {
  if (typeof value !== "object" || value === null) return false;
  if (!("value" in value) || typeof value.value !== "string") return false;
  if (!("mode" in value) || typeof value.mode !== "string") return false;
  return Object.keys(PILL_MODE_SYMBOL).includes(value.mode);
}

/** A filter as it comes back out of storage: whatever shape the build that wrote it had, so its
 * pill map is read as an untrusted map rather than as today's exact set of dimensions. */
export interface PersistedListFilter {
  preset: ListPreset;
  pills: Record<string, unknown>;
}

/**
 * Rebuilds a persisted filter's pill map so it holds exactly today's dimensions. A dimension added
 * since it was written comes back empty rather than `undefined`, and one that has been retired —
 * Parent, subsumed by Antecedent and already named in every row's path header — is dropped rather
 * than carried forward as a filter that still narrows the list while no chip shows it and no
 * control can clear it. Only the keys in {@link PILL_DIMENSIONS} are read, so a retired key is
 * simply never looked at, whatever it holds.
 */
export function withCurrentPillDimensions(filter: PersistedListFilter): ListFilterState {
  const pills: Record<PillDimension, PillFilter[]> = { ...DEFAULT_LIST_FILTER.pills };
  for (const dimension of PILL_DIMENSIONS) {
    const persisted = filter.pills[dimension];
    pills[dimension] = Array.isArray(persisted) ? persisted.filter(isPillFilter) : [];
  }
  return { preset: filter.preset, pills };
}

/** One flattened Task row, precomputed with everything the filters and UI need. */
export interface TaskListRow {
  node: MindmapNode;
  /** Every ancestor, root Aspect first and immediate parent last. The Antecedent filter matches
   * against this whole chain, and the row's path header names the part of it that is off screen. */
  ancestors: MindmapNode[];
  /** Nearest ancestor Goal, if any (SPEC: a task's goal is its nearest Goal ancestor). */
  goalRef: string | null;
  goalStatus: string | null;
  /** Nearest ancestor Project, if any. */
  projectRef: string | null;
  projectStatus: string | null;
  /** This task's own dependency edges, as target node ids ("task-<id>" / "goal-<id>"). */
  dependencyRefs: string[];
  isBlocked: boolean;
  hasBlockedAncestor: boolean;
  /** Whether the task reads as Agentic — its own flag, or the nearest flagged ancestor's. Resolved
   * once when the row is built, the same way the row's blocked-ness is. */
  isAgentic: boolean;
  /** Whether doing this task starts a wait. Its own flag and nothing else — the value does not
   * inherit, so unlike `isAgentic` there is no chain to resolve. */
  isAsynchronous: boolean;
  /** Whether any ancestor (Project/Goal/Domain/Aspect) is marked private — outside Private Mode the
   * subtree is hidden as a unit even when the task itself isn't flagged (mirrors the Mindmap's
   * tree-pruning). */
  hasPrivateAncestor: boolean;
  scopeTokens: string[];
}

/** One flattened Commitment row, for the section that sits above the task rows.
 *
 * Deliberately thinner than a {@link TaskListRow}: a Commitment has no dependencies, no blockers,
 * no Plan and no Goal/Project status of its own to filter on, so the fields that would carry
 * those are not merely empty — they are absent, and the filter cannot ask about them by mistake.
 */
export interface CommitmentListRow {
  node: MindmapNode;
  /** Every ancestor, root Aspect first and immediate parent last — what the Antecedent filter
   * matches against. */
  ancestors: MindmapNode[];
  /** Whether any ancestor is marked private — the subtree hides as a unit outside Private Mode. */
  hasPrivateAncestor: boolean;
  scopeTokens: string[];
}

/** One flattened Expectation row — a wait, stored or a delegated Task's virtual one. As thin as a
 * {@link CommitmentListRow}, for the same reason: a wait has no status to cycle, no Plan, no tags
 * and no dependencies of its own. */
export interface ExpectationListRow {
  node: MindmapNode;
  /** Every ancestor, root Aspect first and immediate parent last. */
  ancestors: MindmapNode[];
  /** Whether any ancestor is marked private — the subtree hides as a unit outside Private Mode. */
  hasPrivateAncestor: boolean;
  /** Its own Time Scope's scope-state tokens, read the way a Task row's are. */
  scopeTokens: string[];
}

/**
 * The values an **Antecedent** pill is matched against: every node on the row's ancestor chain, at
 * any depth and of any kind (Aspect, Domain, Project, Goal, Task).
 *
 * This is deliberately *not* what entering a subtree does, and it did not stop being needed when
 * `Ctrl+O` landed. Subtree entry **re-roots** the list: everything outside the chosen branch is
 * gone, and the branch becomes the whole board. An Antecedent pill keeps the board and narrows it —
 * the rest of the tree is still there to be un-narrowed by clearing one chip — and it carries the
 * Any/All/**Exclude** modes, so "everything except what is under ARLESH" is expressible at all.
 * "Show me only what is under ARLESH" and "highlight the ARLESH work among everything else" are
 * different questions, and only the first is subtree entry.
 *
 * Shared by the task rows and the commitment rows so the two cannot answer the chain differently.
 */
function ancestorRefs(ancestors: readonly MindmapNode[]): string[] {
  return ancestors.map((ancestor) => ancestor.id);
}

/** Combined pill predicate per SPEC Filtering Logic: (∪Any) ∧ (∩All) ∧ ¬(∪Exclude). */
export function matchesPillGroup(filters: readonly PillFilter[], rowValues: readonly string[]): boolean {
  if (filters.length === 0) return true;
  const has = (v: string) => rowValues.includes(v);
  const any = filters.filter((f) => f.mode === "any");
  if (any.length > 0 && !any.some((f) => has(f.value))) return false;
  if (!filters.filter((f) => f.mode === "all").every((f) => has(f.value))) return false;
  if (filters.filter((f) => f.mode === "exclude").some((f) => has(f.value))) return false;
  return true;
}

/** A task's Scope-state tokens: exactly one scoped/unscoped-lifecycle token, and one planned/unplanned
 * token — independent axes, so e.g. "unscoped" + "planned" can both apply to the same task. This
 * dimension's own semantics predate the archivedMode filter and are deliberately preserved exactly:
 * a Completed (done, lapsed) item still reads as "active" here, same as before Resolution existed —
 * only a Missed or Overdue resolution earns the "lapsed"/"overdue" token. */
export function deriveScopeStateTokens(node: MindmapNode): string[] {
  const tokens: string[] = [];
  if (node.timeScope == null) {
    tokens.push("unscoped");
  } else if (node.timing !== undefined) {
    if (node.resolution === "missed") tokens.push("lapsed");
    else if (node.resolution === "overdue") tokens.push("overdue");
    else tokens.push("active");
  }
  tokens.push(node.plan != null ? "planned" : "unplanned");
  return tokens;
}

/**
 * Whether some ancestor of a row gates the whole subtree beneath it under this filter.
 *
 * Three rules hide a node *together with everything under it*: a Frozen/Archived Project shelved by
 * Plan/Start, a backlogged Task, and a habit occurrence whose window has not opened. The Mindmap
 * gets that for free from tree-pruning — drop the node and its descendants go with it — but a flat
 * list has no tree to prune, so it asks each row's chain outright. (A row's own three are handled
 * by `typeHardHidden`, before this runs.)
 *
 * Shared by the task rows and the commitments band so the band cannot keep a Commitment from a
 * branch the rows have dropped.
 */
function hasGatingAncestor(ancestors: readonly MindmapNode[], f: FilterState): boolean {
  return ancestors.some((a) => isShelvedProject(a, f) || isHiddenBacklog(a, f) || isUnopenedOccurrence(a, f));
}

/** The nearest ancestor's own Plan position — what an unplanned row inherits under Start. */
function inheritedPlan(ancestors: readonly MindmapNode[]): Timing | undefined {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];
    // A wait cuts the chain, as on the canvas: a check task answers to its own due time.
    if (ancestor?.kind === "expectation") return undefined;
    const plan = ancestor?.planTiming;
    if (plan !== undefined) return plan;
  }
  return undefined;
}

/** Task-only status-preset predicate (List View rows are always tasks, so no container logic is
 * needed here, unlike the Mindmap's passesStatus). Mirrors filter-tree.ts's task branches — including
 * its effective-Archival clause, so a lapsed task archives out of Plan here exactly as it does on the
 * canvas — plus an explicit blocked-ancestor check, since a flat list has no tree-pruning to cut off a
 * blocked subtree. */
function passesListPreset(row: TaskListRow, f: FilterState): boolean {
  if (hasGatingAncestor(row.ancestors, f)) return false;
  switch (f.statusMode) {
    case "all":
      return true;
    case "plan":
      return withArchivedOverride(row.node, f, row.node.status !== "done" && !isArchived(row.node));
    case "start": {
      if (row.isBlocked || row.hasBlockedAncestor) return false;
      // A flat list has no walk to carry a Plan down, so the row asks its own chain.
      if (isPlannedAhead(row.node, f, inheritedPlan(row.ancestors))) return false;
      if (row.node.timing === "lapsed" || isDelegated(row.node)) return withArchivedOverride(row.node, f, false);
      if (row.node.status === "done") return false;
      if (row.node.status === "in_progress" && !row.node.children.some((c) => c.kind === "task" && c.status === "todo")) {
        return false;
      }
      return true;
    }
    case "do":
      return row.node.status === "in_progress";
    case "backlog":
      // Everything set aside, plus everything beneath it — the Mindmap's subtree rule, flattened.
      return row.node.backlogged === true || row.ancestors.some((a) => a.backlogged === true);
  }
}

/**
 * The shared filter as Unblock reads it: the same tags, Info/Flow/Private toggles and Archived/Backlog
 * pills, with the status preset neutralised to All.
 *
 * Unblock is not a sixth preset a user combines with the one they had — the List View dropdown holds
 * a single value, and picking Unblock *is* the whole question ("what is blocking me?"). The preset
 * left in the shared FilterState belongs to the Mindmap, which keeps it, and it must not answer here:
 * Start hard-hides a blocked task together with its subtree, which is precisely the set Unblock
 * exists to show, so reading it left Unblock-over-Start an empty list. Neutralising the preset also
 * keeps the row's own rules and its ancestors' in step, since {@link passesListPreset} — and with it
 * every preset-driven ancestor walk — is skipped under Unblock too.
 */
function unblockSharedFilter(shared: FilterState): FilterState {
  return { ...shared, statusMode: "all" };
}

/** Whether one row survives the shared filter (status preset, tags, Info/Flow/Private) and the
 * List-View-exclusive filters. Unblock overrides the status preset to "blocked tasks only". */
function rowPassesFilters(row: TaskListRow, shared: FilterState, listFilter: ListFilterState): boolean {
  // The Expectations option shows waits and nothing else.
  if (listFilter.preset === "expectations") return false;
  const effectiveShared = listFilter.preset === "unblock" ? unblockSharedFilter(shared) : shared;
  if (typeHardHidden(row.node, effectiveShared)) return false;
  if (!shared.privateMode && row.hasPrivateAncestor) return false;
  if (listFilter.preset === "unblock") {
    if (!row.isBlocked) return false;
  } else if (!passesListPreset(row, shared)) {
    return false;
  }
  if (!passesTags(row.node, shared)) return false;
  if (!matchesPillGroup(listFilter.pills.antecedent, ancestorRefs(row.ancestors))) return false;
  if (!matchesPillGroup(listFilter.pills.dependency, row.dependencyRefs)) return false;
  if (!matchesPillGroup(listFilter.pills.taskStatus, [row.node.status ?? ""])) return false;
  if (!matchesPillGroup(listFilter.pills.goalStatus, row.goalStatus !== null ? [row.goalStatus] : [])) return false;
  if (!matchesPillGroup(listFilter.pills.projectStatus, row.projectStatus !== null ? [row.projectStatus] : [])) return false;
  if (!matchesPillGroup(listFilter.pills.scopeState, row.scopeTokens)) return false;
  if (!matchesPillGroup(listFilter.pills.blocked, [row.isBlocked ? "blocked" : "not_blocked"])) return false;
  if (!matchesPillGroup(listFilter.pills.agentic, [row.isAgentic ? "agentic" : "not_agentic"])) return false;
  if (!matchesPillGroup(listFilter.pills.asynchronous, [row.isAsynchronous ? "asynchronous" : "not_asynchronous"])) return false;
  return true;
}

/**
 * Filters the flattened Commitment rows for the section above the task rows.
 *
 * The preset rules are the Commitment ones — All shows everything including past verdicts,
 * Plan shows unresolved plus broken-while-the-window-is-still-open, Start and Do show
 * unresolved — and they come from the same {@link passesCommitmentPreset} the Mindmap uses, so
 * the two surfaces cannot drift.
 *
 * Only the pill dimensions a Commitment actually has are consulted: antecedent, scope state and
 * verdict. A Commitment hangs off the same tree as everything else, so it has a full ancestor
 * chain and answers an Antecedent pill exactly as a task row does — narrowing to a branch would be
 * a lie if the band above the rows kept showing commitments from outside it. A task-status or
 * blocked pill, by contrast, is not "failed" by a commitment, it simply does not apply to one —
 * filtering the whole section away because the user asked to see in-progress tasks would be
 * answering a question nobody asked.
 *
 * Two presets are special. **Unblock** is about blocked tasks and a Commitment is never blocked,
 * so the section is empty there. **Backlog** is a Task-only state, so it is empty there too.
 *
 * The ancestor walk is literally the task rows' — {@link hasGatingAncestor}, shared so the two
 * cannot drift apart. A Commitment hangs off the same tree, so a branch hidden as a whole subtree
 * (a shelved Project, a backlogged Task, a habit occurrence whose window has not opened) takes the
 * commitments inside it with it; a band still showing one from a branch the list has dropped would
 * be describing a different board.
 */
export function filterCommitmentList(
  rows: readonly CommitmentListRow[],
  shared: FilterState,
  listFilter: ListFilterState,
): CommitmentListRow[] {
  return rows.filter((row) => commitmentPassesFilters(row, shared, listFilter));
}

/** One Commitment row against the filters — the predicate {@link filterCommitmentList} applies. */
function commitmentPassesFilters(row: CommitmentListRow, shared: FilterState, listFilter: ListFilterState): boolean {
  if (listFilter.preset === "unblock" || listFilter.preset === "backlog" || listFilter.preset === "expectations") {
    return false;
  }
  if (typeHardHidden(row.node, shared)) return false;
  if (!shared.privateMode && row.hasPrivateAncestor) return false;
  if (hasGatingAncestor(row.ancestors, shared)) return false;
  if (!withArchivedOverride(row.node, shared, passesCommitmentPreset(row.node, shared))) return false;
  if (!passesTags(row.node, shared)) return false;
  if (!matchesPillGroup(listFilter.pills.antecedent, ancestorRefs(row.ancestors))) return false;
  if (!matchesPillGroup(listFilter.pills.scopeState, row.scopeTokens)) return false;
  return matchesPillGroup(listFilter.pills.verdict, [row.node.verdict ?? VERDICT.UNRESOLVED]);
}

/**
 * Filters the flattened Expectation rows — the waits, in their band or among the rows.
 *
 * **Unblock** shows none: a wait is never blocked. The List View's own **Expectations** option
 * replaces the preset's rules, as Unblock does, and keeps every pending, live wait — the hard-hide
 * rules still apply, read under the neutralised filter. Otherwise the preset answers through
 * {@link passesExpectationPreset}, with the same subtree gates the task rows answer, so a branch the
 * list has dropped takes its waits with it. The tag filters apply as they do to a Task, and of the
 * List View's pills the ones a wait can answer: Antecedent and Scope.
 */
export function filterExpectationList(
  rows: readonly ExpectationListRow[],
  shared: FilterState,
  listFilter: ListFilterState,
): ExpectationListRow[] {
  return rows.filter((row) => expectationPassesFilters(row, shared, listFilter));
}

/** One Expectation row against the filters — the predicate {@link filterExpectationList} applies. */
function expectationPassesFilters(row: ExpectationListRow, shared: FilterState, listFilter: ListFilterState): boolean {
  if (listFilter.preset === "unblock") return false;
  const onlyWaits = listFilter.preset === "expectations";
  const effective = onlyWaits ? unblockSharedFilter(shared) : shared;
  if (typeHardHidden(row.node, effective)) return false;
  if (!shared.privateMode && row.hasPrivateAncestor) return false;
  if (onlyWaits) {
    if (!isLiveExpectation(row.node)) return false;
  } else {
    if (hasGatingAncestor(row.ancestors, shared)) return false;
    if (!withArchivedOverride(row.node, shared, passesExpectationPreset(row.node, shared))) return false;
  }
  if (!passesTags(row.node, shared)) return false;
  if (!matchesPillGroup(listFilter.pills.scopeState, row.scopeTokens)) return false;
  return matchesPillGroup(listFilter.pills.antecedent, ancestorRefs(row.ancestors));
}

/** Filters the flattened task rows per the shared filter (status preset, tags, Info/Flow/Private) and
 * the List-View-exclusive filters. Unblock overrides the status preset to "blocked tasks only". */
export function filterTaskList(
  rows: readonly TaskListRow[],
  shared: FilterState,
  listFilter: ListFilterState,
): TaskListRow[] {
  return rows.filter((row) => rowPassesFilters(row, shared, listFilter));
}

/** Filtered rows plus the ids kept **only** by the focus exemption — rendered dimmed. */
export interface FocusFilteredRows<Row = TaskListRow> {
  rows: Row[];
  exemptedIds: ReadonlySet<string>;
}

/**
 * Keeps the rows `passes` keeps, plus the focused one whatever `passes` says, and names it as
 * exempted. One rule for every kind of row the List View draws — a Task, a Commitment, a wait — so
 * the selected row stays under the cursor whichever kind it is.
 */
function keepWithFocus<Row extends { node: { id: string } }>(
  rows: readonly Row[],
  passes: (row: Row) => boolean,
  focusedId: string | null,
): FocusFilteredRows<Row> {
  const exemptedIds = new Set<string>();
  const kept = rows.filter((row) => {
    if (passes(row)) return true;
    if (focusedId === null || row.node.id !== focusedId) return false;
    exemptedIds.add(row.node.id);
    return true;
  });
  return { rows: kept, exemptedIds };
}

/** {@link filterCommitmentList}, with the focus exemption — see {@link filterTaskListWithFocus}. */
export function filterCommitmentListWithFocus(
  rows: readonly CommitmentListRow[],
  shared: FilterState,
  listFilter: ListFilterState,
  focusedId: string | null,
): FocusFilteredRows<CommitmentListRow> {
  return keepWithFocus(rows, (row) => commitmentPassesFilters(row, shared, listFilter), focusedId);
}

/** {@link filterExpectationList}, with the focus exemption — see {@link filterTaskListWithFocus}. */
export function filterExpectationListWithFocus(
  rows: readonly ExpectationListRow[],
  shared: FilterState,
  listFilter: ListFilterState,
  focusedId: string | null,
): FocusFilteredRows<ExpectationListRow> {
  return keepWithFocus(rows, (row) => expectationPassesFilters(row, shared, listFilter), focusedId);
}

/**
 * The same filtering, with the **focus exemption** applied: the focused row stays in the list, in its
 * own place, whatever the filter says about it, for as long as it stays selected. A flat list has no
 * chain to carry — a row's hidden ancestors are already named by its path header — so the exemption
 * here is exactly one row.
 *
 * `filterTaskList` still answers as it always did, so nothing that counts or exports off the filter
 * sees the extra row.
 */
export function filterTaskListWithFocus(
  rows: readonly TaskListRow[],
  shared: FilterState,
  listFilter: ListFilterState,
  focusedId: string | null,
): FocusFilteredRows {
  return keepWithFocus(rows, (row) => rowPassesFilters(row, shared, listFilter), focusedId);
}
