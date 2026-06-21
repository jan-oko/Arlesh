/** Maps a Goal status to the closest equivalent Task status per SPEC type-cycling rules. */
export function goalStatusToTaskStatus(
  goalStatus: string,
): "todo" | "in_progress" | "done" {
  if (goalStatus === "achieved") return "done";
  return "todo";
}

/** Maps a Task status to the closest equivalent Goal status per SPEC type-cycling rules. */
export function taskStatusToGoalStatus(
  taskStatus: string,
): "active" | "achieved" | "frozen" | "archived" {
  if (taskStatus === "done") return "achieved";
  return "active";
}
