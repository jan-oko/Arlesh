import type { MindmapNode } from "@/utils/tree-layout";
import type { AgenticStatus, OrdinaryStatus, Task, TaskStatus } from "@/api/tasks";
import { TASK_ARCHIVAL } from "@/api/tasks";
import { AGENTIC_STATUS, TASK_STATUS, agentic, ordinary } from "@/utils/status-mapping";

/**
 * The status the click/`Enter` cycle moves a Task to next — in the model the Task holds.
 *
 * - **Ordinary**: To Do → In Progress → Done → To Do. A **Started** Task — begun and paused — goes
 *   to In Progress, as To Do does: `Enter` resumes it.
 * - **Agentic**: To Do → Doing → Done → To Do. **Review** goes to Doing — the user takes up what
 *   the agent asked about — and so does **On Agent** (when it is shown at all): the user takes it
 *   over.
 *
 * Shared by the Mindmap, the List View, the Steps View and the Zen View, which offer the same
 * gesture on the same rows: two views cycling a status differently would be a bug nobody would
 * think to look for.
 */
export function nextTaskStatus(current: TaskStatus): TaskStatus {
  return current.kind === "agentic" ? agentic(nextAgentic(current.status)) : ordinary(nextOrdinary(current.status));
}

function nextOrdinary(current: OrdinaryStatus): OrdinaryStatus {
  if (current === TASK_STATUS.IN_PROGRESS) return TASK_STATUS.DONE;
  if (current === TASK_STATUS.DONE) return TASK_STATUS.TODO;
  return TASK_STATUS.IN_PROGRESS;
}

function nextAgentic(current: AgenticStatus): AgenticStatus {
  if (current === AGENTIC_STATUS.DOING) return AGENTIC_STATUS.DONE;
  if (current === AGENTIC_STATUS.DONE) return AGENTIC_STATUS.TODO;
  return AGENTIC_STATUS.DOING;
}

/** What `Alt+Enter` does to a Task: a status to write, or a refusal to say out loud. */
export type AltStep =
  | { next: TaskStatus }
  /** A key of the `warnings` namespace saying why nothing was written. */
  | { refused: "altEnterAgenticNotDoing" };

/**
 * The step `Alt+Enter` takes, in the model the Task holds.
 *
 * - **Ordinary**: **Started** from To Do, In Progress or Done, and back to In Progress from
 *   Started — so on work under way it pauses and resumes.
 * - **Agentic**: it **hands the Task back** to the agent — Doing → On Agent (which reads Review
 *   again while the agent's question is still open). Started is not an Agentic status, so on any
 *   other status it is refused out loud.
 */
export function altEnterStep(current: TaskStatus): AltStep {
  if (current.kind === "agentic") {
    if (current.status === AGENTIC_STATUS.DOING) return { next: agentic(AGENTIC_STATUS.ON_AGENT) };
    return { refused: "altEnterAgenticNotDoing" };
  }
  if (current.status === TASK_STATUS.STARTED) return { next: ordinary(TASK_STATUS.IN_PROGRESS) };
  return { next: ordinary(TASK_STATUS.STARTED) };
}

/**
 * Whether the write that produced `after` took the Task out of the Backlog.
 *
 * Starting a set-aside Task — beginning work on it, in either model — clears its Backlog flag: you
 * cannot be doing something you have deliberately put down (see
 * [*Tasks*](../../docs/spec/resources.md)) — and the change must be named rather than left to be
 * noticed.
 *
 * Read off the row the backend sent back, not predicted from the request: the rule belongs to the
 * model, the same way the Plan pair's refusal does, and a frontend guess about it is one more place
 * for the two to drift apart.
 */
export function cameOutOfBacklog(before: MindmapNode, after: Task): boolean {
  return before.backlogged === true && after.archival === TASK_ARCHIVAL.LIVE;
}

/**
 * The toast that names a Task coming out of the Backlog, for the status that brought it out:
 * Started, or any other start. A key of the `warnings` namespace.
 */
export function backlogClearedMessage(status: TaskStatus): "backlogClearedByStart" | "backlogClearedByStarted" {
  return status.kind === "ordinary" && status.status === TASK_STATUS.STARTED
    ? "backlogClearedByStarted"
    : "backlogClearedByStart";
}
