import type { MindmapNode } from "@/utils/tree-layout";
import type { FilterState, TagFilterMode } from "@/utils/filter-tree";
import {
  typeHardHidden, passesTags, withArchivedOverride, isShelvedProject, isHiddenBacklog,
  passesCommitmentPreset,
} from "@/utils/filter-tree";
import { TASK_STATUS, GOAL_STATUS, PROJECT_STATUS } from "@/utils/status-mapping";
import type { Verdict } from "@/api/commitments";
import { VERDICT, VERDICT_VALUES } from "@/api/commitments";

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

/** The List-View-exclusive filter dimensions (status preset, tags, and type toggles stay in the shared FilterState). */
export type PillDimension =
  | "parent" | "dependency"
  | "taskStatus" | "goalStatus" | "projectStatus" | "verdict"
  | "scopeState" | "blocked";

export const PILL_DIMENSIONS: PillDimension[] = [
  "parent", "dependency",
  "taskStatus", "goalStatus", "projectStatus", "verdict",
  "scopeState", "blocked",
];

/** List View's own preset selector: All/Plan/Start/Do write through to the shared status preset;
 * Unblock is List-View-only and does not touch it (see SPEC List View section). */
export const LIST_PRESET_VALUES = ["all", "plan", "start", "do", "backlog", "unblock"] as const;
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

export type TaskStatusValue = (typeof TASK_STATUS_VALUES)[number];
export type GoalStatusValue = (typeof GOAL_STATUS_VALUES)[number];
export type ProjectStatusValue = (typeof PROJECT_STATUS_VALUES)[number];
export type ScopeStateValue = (typeof SCOPE_STATE_VALUES)[number];
export type BlockedValue = (typeof BLOCKED_VALUES)[number];

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

export interface ListFilterState {
  preset: ListPreset;
  pills: Record<PillDimension, PillFilter[]>;
}

export const DEFAULT_LIST_FILTER: ListFilterState = {
  preset: "all",
  pills: {
    parent: [], dependency: [],
    taskStatus: [], goalStatus: [], projectStatus: [], verdict: [],
    scopeState: [], blocked: [],
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
 * Antecedent, replaced by subtree entry — is dropped rather than carried forward as a filter that
 * still narrows the list while no chip shows it and no control can clear it.
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
  /** Tree node id of the immediate parent (Project/Goal/Domain/Task). */
  parentRef: string;
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
  /** Tree node id of the immediate parent. */
  parentRef: string;
  /** Tree node ids of every ancestor, immediate parent to root aspect. */
  ancestors: MindmapNode[];
  /** Whether any ancestor is marked private — the subtree hides as a unit outside Private Mode. */
  hasPrivateAncestor: boolean;
  scopeTokens: string[];
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

/** Task-only status-preset predicate (List View rows are always tasks, so no container logic is
 * needed here, unlike the Mindmap's passesStatus). Mirrors filter-tree.ts's task branches — including
 * its effective-Archival clause, so a lapsed task archives out of Plan here exactly as it does on the
 * canvas — plus an explicit blocked-ancestor check, since a flat list has no tree-pruning to cut off a
 * blocked subtree. */
function passesListPreset(row: TaskListRow, f: FilterState): boolean {
  // A Frozen/Archived Project shelves its whole subtree in Plan/Start. The Mindmap drops it by
  // tree-pruning; a flat list needs the explicit ancestor walk (no-op under All/Do).
  if (row.ancestors.some((a) => isShelvedProject(a, f))) return false;
  // Likewise a backlogged ancestor Task: the Mindmap prunes the subtree away, a flat list has to
  // walk for it. (The row's own backlog is handled by `typeHardHidden`, before this runs.)
  if (row.ancestors.some((a) => isHiddenBacklog(a, f))) return false;
  switch (f.statusMode) {
    case "all":
      return true;
    case "plan":
      return withArchivedOverride(row.node, f, row.node.status !== "done" && row.node.archived !== true);
    case "start": {
      if (row.isBlocked || row.hasBlockedAncestor) return false;
      if (row.node.timing === "lapsed") return withArchivedOverride(row.node, f, false);
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

/** Whether one row survives the shared filter (status preset, tags, Info/Flow/Private) and the
 * List-View-exclusive filters. Unblock overrides the status preset to "blocked tasks only". */
function rowPassesFilters(row: TaskListRow, shared: FilterState, listFilter: ListFilterState): boolean {
  if (typeHardHidden(row.node, shared)) return false;
  if (!shared.privateMode && row.hasPrivateAncestor) return false;
  if (listFilter.preset === "unblock") {
    if (!row.isBlocked) return false;
  } else if (!passesListPreset(row, shared)) {
    return false;
  }
  if (!passesTags(row.node, shared)) return false;
  if (!matchesPillGroup(listFilter.pills.parent, [row.parentRef])) return false;
  if (!matchesPillGroup(listFilter.pills.dependency, row.dependencyRefs)) return false;
  if (!matchesPillGroup(listFilter.pills.taskStatus, [row.node.status ?? ""])) return false;
  if (!matchesPillGroup(listFilter.pills.goalStatus, row.goalStatus !== null ? [row.goalStatus] : [])) return false;
  if (!matchesPillGroup(listFilter.pills.projectStatus, row.projectStatus !== null ? [row.projectStatus] : [])) return false;
  if (!matchesPillGroup(listFilter.pills.scopeState, row.scopeTokens)) return false;
  if (!matchesPillGroup(listFilter.pills.blocked, [row.isBlocked ? "blocked" : "not_blocked"])) return false;
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
 * Only the pill dimensions a Commitment actually has are consulted: parent, scope state and
 * verdict. A task-status or blocked pill is not "failed" by a commitment, it simply
 * does not apply to one — filtering the whole section away because the user asked to see
 * in-progress tasks would be answering a question nobody asked.
 *
 * Two presets are special. **Unblock** is about blocked tasks and a Commitment is never blocked,
 * so the section is empty there. **Backlog** is a Task-only state, so it is empty there too.
 */
export function filterCommitmentList(
  rows: readonly CommitmentListRow[],
  shared: FilterState,
  listFilter: ListFilterState,
): CommitmentListRow[] {
  if (listFilter.preset === "unblock" || listFilter.preset === "backlog") return [];
  return rows.filter((row) => {
    if (typeHardHidden(row.node, shared)) return false;
    if (!shared.privateMode && row.hasPrivateAncestor) return false;
    if (row.ancestors.some((a) => isShelvedProject(a, shared))) return false;
    if (row.ancestors.some((a) => isHiddenBacklog(a, shared))) return false;
    if (!withArchivedOverride(row.node, shared, passesCommitmentPreset(row.node, shared))) {
      return false;
    }
    if (!passesTags(row.node, shared)) return false;
    if (!matchesPillGroup(listFilter.pills.parent, [row.parentRef])) return false;
    if (!matchesPillGroup(listFilter.pills.scopeState, row.scopeTokens)) return false;
    if (!matchesPillGroup(listFilter.pills.verdict, [row.node.verdict ?? VERDICT.UNRESOLVED])) {
      return false;
    }
    return true;
  });
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
export interface FocusFilteredRows {
  rows: TaskListRow[];
  exemptedIds: ReadonlySet<string>;
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
  const exemptedIds = new Set<string>();
  const kept = rows.filter((row) => {
    if (rowPassesFilters(row, shared, listFilter)) return true;
    if (focusedId === null || row.node.id !== focusedId) return false;
    exemptedIds.add(row.node.id);
    return true;
  });
  return { rows: kept, exemptedIds };
}
