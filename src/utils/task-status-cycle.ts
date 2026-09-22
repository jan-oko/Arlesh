import type { MindmapNode } from "@/utils/tree-layout";
import type { Task } from "@/api/tasks";
import { TASK_ARCHIVAL } from "@/api/tasks";
import { TASK_STATUS } from "@/utils/status-mapping";

/**
 * The status the click/`Enter` cycle moves a Task to next: To Do → In Progress → Done → To Do.
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
 * Whether the write that produced `after` took the Task out of the Backlog.
 *
 * Setting a set-aside Task In Progress clears its Backlog flag — you cannot be actively doing
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
