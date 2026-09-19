export const TASK_STATUS = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  DONE: "done",
} as const;

export const GOAL_STATUS = {
  ACTIVE: "active",
  ACHIEVED: "achieved",
  FROZEN: "frozen",
  ARCHIVED: "archived",
} as const;

/** Project lifecycle status (SPEC: Active / Achieved / Frozen / Archived) — the same vocabulary as a
 * Goal's, and the only one the `domains.status` CHECK constraint and Rust's `ProjectStatus` accept. */
export const PROJECT_STATUS = {
  ACTIVE: "active",
  ACHIEVED: "achieved",
  FROZEN: "frozen",
  ARCHIVED: "archived",
} as const;

/** Maps a Goal status to the closest equivalent Task status per SPEC type-cycling rules. */
export function goalStatusToTaskStatus(
  goalStatus: string,
): "todo" | "in_progress" | "done" {
  if (goalStatus === GOAL_STATUS.ACHIEVED) return TASK_STATUS.DONE;
  return TASK_STATUS.TODO;
}

/** Maps a Task status to the closest equivalent Goal status per SPEC type-cycling rules. */
export function taskStatusToGoalStatus(
  taskStatus: string,
): "active" | "achieved" | "frozen" | "archived" {
  if (taskStatus === TASK_STATUS.DONE) return GOAL_STATUS.ACHIEVED;
  return GOAL_STATUS.ACTIVE;
}
