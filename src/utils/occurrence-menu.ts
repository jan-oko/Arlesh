import type { MindmapNode } from "@/utils/tree-layout";
import { GOAL_STATUS, TASK_STATUS } from "@/utils/status-mapping";

/** A status an occurrence's menu can set it to. */
export type OccurrenceStatus = "todo" | "in_progress" | "done" | "active" | "achieved";

/** What one entry of a Habit occurrence's context menu does. */
export type OccurrenceMenuAction =
  | "edit"
  | "plan"
  | "follow-cycle-plan"
  | "unplan"
  | "archive"
  | "unarchive"
  | "collapse"
  | "expand"
  | `status:${OccurrenceStatus}`;

/** Every action a menu can carry, for narrowing an action string that arrived untyped. */
const ACTIONS: readonly string[] = [
  "edit", "plan", "follow-cycle-plan", "unplan", "archive", "unarchive", "collapse", "expand",
  "status:todo", "status:in_progress", "status:done", "status:active", "status:achieved",
] satisfies readonly OccurrenceMenuAction[];

export function isOccurrenceMenuAction(value: string): value is OccurrenceMenuAction {
  return ACTIONS.includes(value);
}

/** One row of the menu, grouped so the component can draw separators between groups. */
export interface OccurrenceMenuEntry {
  action: OccurrenceMenuAction;
  group: "edit" | "status" | "plan" | "tree" | "archive";
}

/** The statuses a node of this kind can be set to, other than the one it has. */
function statusEntries(node: MindmapNode): OccurrenceMenuEntry[] {
  // A commitment iteration is kept or broken, never given a status — its verdict controls are its
  // own, as on a real Commitment.
  if (node.kind === "commitment") return [];
  const statuses: OccurrenceStatus[] = node.kind === "goal"
    ? [GOAL_STATUS.ACTIVE, GOAL_STATUS.ACHIEVED]
    : [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS, TASK_STATUS.DONE];
  const current = node.status ?? (node.kind === "goal" ? GOAL_STATUS.ACTIVE : TASK_STATUS.TODO);
  return statuses
    .filter((status) => status !== current)
    .map((status) => ({ action: `status:${status}`, group: "status" }));
}

/**
 * The context menu of a Habit occurrence — an item's, or the iteration root, which for a Habit with
 * no items *is* the occurrence: only what applies to it, and nothing drawn dead.
 *
 * It is edited, given a status (a commitment iteration keeps its verdict controls instead), planned
 * when it renders as a task — open the editor on its Plan, hand it back to the Cycle Plan, or leave
 * it unplanned this time — collapsed, and archived by hand. An archived one offers its editor and
 * Unarchive, and nothing else.
 *
 * `canCollapse` is false on a surface that draws no subtree to fold (the List View).
 *
 * `null` for any node that is not a Habit occurrence at all.
 */
export function occurrenceMenuEntries(
  node: MindmapNode,
  isCollapsed: boolean,
  canCollapse = true,
): OccurrenceMenuEntry[] | null {
  if (node.habitItem === undefined) return null;
  if (node.occurrence?.archived === true) {
    return [{ action: "edit", group: "edit" }, { action: "unarchive", group: "archive" }];
  }
  const tree: OccurrenceMenuEntry[] = canCollapse && node.children.length > 0
    ? [{ action: isCollapsed ? "expand" : "collapse", group: "tree" }]
    : [];
  const plan: OccurrenceMenuEntry[] = [];
  if (node.kind === "task") {
    plan.push({ action: "plan", group: "plan" });
    if (node.planOverridden === true) plan.push({ action: "follow-cycle-plan", group: "plan" });
    if (!(node.planOverridden === true && node.plan == null)) plan.push({ action: "unplan", group: "plan" });
  }
  return [
    { action: "edit", group: "edit" },
    ...statusEntries(node),
    ...plan,
    ...tree,
    { action: "archive", group: "archive" },
  ];
}

/**
 * The stored status a menu status writes for an occurrence: the base status clears the
 * Modification (`null`), and a goal's "achieved" is stored canonically as `done`.
 */
export function storedOccurrenceStatus(status: OccurrenceStatus): string | null {
  if (status === TASK_STATUS.TODO || status === GOAL_STATUS.ACTIVE) return null;
  if (status === GOAL_STATUS.ACHIEVED) return TASK_STATUS.DONE;
  return status;
}
