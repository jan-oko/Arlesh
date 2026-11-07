import type { AgenticStatus, OrdinaryStatus, TaskStatus } from "@/api/tasks";

/** The **ordinary** Task status model's values. */
export const TASK_STATUS = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  /** Begun and left in a middle state, not being worked on right now. Set by `Alt+Enter`. */
  STARTED: "started",
  DONE: "done",
} as const satisfies Record<string, OrdinaryStatus>;

/** The **Agentic** Task status model's values — a model of its own (see `docs/spec/resources.md`). */
export const AGENTIC_STATUS = {
  TODO: "todo",
  /** An agent holds it. */
  ON_AGENT: "on_agent",
  /** On Agent with the agent's question open for the user: derived, never written. */
  REVIEW: "review",
  /** The user is on it. */
  DOING: "doing",
  DONE: "done",
} as const satisfies Record<string, AgenticStatus>;

/** An ordinary status. */
export function ordinary(status: OrdinaryStatus): TaskStatus {
  return { kind: "ordinary", status };
}

/** An Agentic status. */
export function agentic(status: AgenticStatus): TaskStatus {
  return { kind: "agentic", status };
}

/** Finished, in either model. */
export function isDone(status: TaskStatus | undefined): boolean {
  return status?.status === "done";
}

/** Not begun, in either model. */
export function isTodo(status: TaskStatus | undefined): boolean {
  return status?.status === "todo";
}

/** Begun and not finished, in either model — the move into which is a *start*. */
export function isBegun(status: TaskStatus | undefined): boolean {
  return status !== undefined && status.status !== "todo" && status.status !== "done";
}

/** Whether `status` is the derived Review: On Agent, with the agent's question open. */
export function isReview(status: TaskStatus | undefined): boolean {
  return status?.kind === "agentic" && status.status === "review";
}

/** Whether `status` is On Agent — an agent holds it and nothing is asked of the user. */
export function isOnAgent(status: TaskStatus | undefined): boolean {
  return status?.kind === "agentic" && status.status === "on_agent";
}

/** A To Do in the model a Task of this kind holds. */
export function todoOf(agenticKind: boolean): TaskStatus {
  return agenticKind ? agentic("todo") : ordinary("todo");
}

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

/** The value the row holds: Review is derived, and is On Agent as stored. What a save sends back. */
export function storedStatus(status: TaskStatus): TaskStatus {
  return isReview(status) ? agentic(AGENTIC_STATUS.ON_AGENT) : status;
}

/**
 * The counterpart of `status` in the model a Task of kind `agenticKind` holds — itself when it is
 * already in that model — or `null` when there is none: an ordinary Started has none in the Agentic
 * model, and On Agent (Review included) none in the ordinary one. The backend's
 * `Status::converted`, which a change of kind performs and refuses on when there is none; the
 * editor uses it to show the status a flag change would leave.
 */
export function convertedStatus(status: TaskStatus, agenticKind: boolean): TaskStatus | null {
  if ((status.kind === "agentic") === agenticKind) return status;
  if (status.kind === "ordinary") {
    switch (status.status) {
      case TASK_STATUS.TODO: return agentic(AGENTIC_STATUS.TODO);
      case TASK_STATUS.IN_PROGRESS: return agentic(AGENTIC_STATUS.DOING);
      case TASK_STATUS.DONE: return agentic(AGENTIC_STATUS.DONE);
      case TASK_STATUS.STARTED: return null;
    }
  }
  switch (status.status) {
    case AGENTIC_STATUS.TODO: return ordinary(TASK_STATUS.TODO);
    case AGENTIC_STATUS.DOING: return ordinary(TASK_STATUS.IN_PROGRESS);
    case AGENTIC_STATUS.DONE: return ordinary(TASK_STATUS.DONE);
    case AGENTIC_STATUS.ON_AGENT:
    case AGENTIC_STATUS.REVIEW:
      return null;
  }
}

/** The ordinary model's spellings, to read a node's plain status by. */
const ORDINARY_SPELLINGS: readonly OrdinaryStatus[] = Object.values(TASK_STATUS);

/**
 * A Task node's typed status. Every Task the board loads carries one; a node built without it —
 * by hand, before a load — is read by its plain `status` as an ordinary one, and as an ordinary To
 * Do when that is no ordinary spelling.
 */
export function taskStatusOf(node: { taskStatus?: TaskStatus | undefined; status?: string | undefined }): TaskStatus {
  if (node.taskStatus !== undefined) return node.taskStatus;
  return ordinary(ORDINARY_SPELLINGS.find((spelling) => spelling === node.status) ?? TASK_STATUS.TODO);
}
