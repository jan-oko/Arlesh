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
  if (taskStatus === "blocked") return GOAL_STATUS.FROZEN;
  return GOAL_STATUS.ACTIVE;
}
