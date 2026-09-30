import type { MindmapNode } from "@/utils/tree-layout";
import type { Task } from "@/api/tasks";
import { TASK_ARCHIVAL } from "@/api/tasks";
import { TASK_STATUS } from "@/utils/status-mapping";

/**
 * The status the click/`Enter` cycle moves a Task to next: To Do → In Progress → Done → To Do. A
 * **Started** Task — begun and paused — goes to In Progress, as To Do does: `Enter` resumes it.
 *
 * Shared by the Mindmap and the List View, which offer the same gesture on the same rows: the two
 * views cycling a status differently would be a bug nobody would think to look for.
 */
export function nextTaskStatus(current: string): string {
  if (current === TASK_STATUS.IN_PROGRESS) return TASK_STATUS.DONE;
  if (current === TASK_STATUS.DONE) return TASK_STATUS.TODO;
  return TASK_STATUS.IN_PROGRESS;
}

/**
 * The status `Alt+Enter` moves a Task to: **Started** from To Do, In Progress or Done, and back to
 * In Progress from Started — so on work under way it pauses and resumes.
 */
export function nextStartedStatus(current: string): string {
  if (current === TASK_STATUS.STARTED) return TASK_STATUS.IN_PROGRESS;
  return TASK_STATUS.STARTED;
}

/**
 * Whether the write that produced `after` took the Task out of the Backlog.
 *
 * Setting a set-aside Task In Progress or Started clears its Backlog flag — you cannot be doing
 * something you have deliberately put down (see [*Tasks*](../../docs/spec/resources.md)) — and the
 * change must be named rather than left to be noticed.
 *
 * Read off the row the backend sent back, not predicted from the request: the rule belongs to the
 * model, the same way the Plan pair's refusal does, and a frontend guess about it is one more place
 * for the two to drift apart.
 */
export function cameOutOfBacklog(before: MindmapNode, after: Task): boolean {
  return before.backlogged === true && after.archival === TASK_ARCHIVAL.LIVE;
}

/**
 * The toast that names a Task coming out of the Backlog, for the status that brought it out: In
 * Progress, or Started. A key of the `warnings` namespace.
 */
export function backlogClearedMessage(status: string): "backlogClearedByStart" | "backlogClearedByStarted" {
  return status === TASK_STATUS.STARTED ? "backlogClearedByStarted" : "backlogClearedByStart";
}
