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
