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
