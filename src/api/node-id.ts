import type { ScopeKey } from "@/api/scopes";

/**
 * Which row a node is: a stored row's integer id, or a derived row's UUID (ADR 0008). A Habit's
 * occurrence is an ordinary row of its kind with a UUID id; every request that names a node takes
 * either, and the backend routes a derived one into its overlay.
 */
export type RowId = number | string;

/** Whether `id` names a derived row — a Habit occurrence — rather than a stored one. */
export function isDerivedId(id: RowId): id is string {
  return typeof id === "string";
}

/** The iteration a Habit occurrence is in, as its `origin` carries it. */
export interface IterationScope {
  /** Zero-based ordinal from the Repetition Start. */
  index: number;
  /** The date the iteration's window starts on, ISO `YYYY-MM-DD`. */
  start_date: string;
  /** The window's exclusive end, ISO `YYYY-MM-DDTHH:MM:SS`. */
  window_end: string;
  /** The scope anchoring the window's first period. */
  scope_id: ScopeKey;
  /** The Habit's own window kind (`day`, `week`, `month`, `season`, or `part`), if scoped. */
  kind: string | null;
  /** The iteration's derived state. */
  status: "active" | "done" | "lapsed" | "missed" | "upcoming" | "expired";
}

/** A Habit occurrence's provenance. */
export interface HabitOrigin {
  kind: "habit";
  habit_id: number;
  iteration_scope: IterationScope;
  /** `flow_root` for the iteration's root, else the template item's table. */
  item_type: "flow_root" | "flow_goal" | "flow_task";
  item_id: number;
  cycle_id: number;
}

/** A wait's check task: which check on which wait. */
export interface CheckOrigin {
  kind: "check";
  /** A stored Expectation's check, or one on the wait a Task spawned. */
  wait_kind: "stored" | "spawned";
  /** The Expectation's id, or the spawning Task's. */
  wait_id: number;
  /** When the check fell due, ISO `YYYY-MM-DDTHH:MM:SS`. */
  due_at: string;
}

/** A wait derived from a Task: the one its completion spawned, or the one its delegation holds. */
export interface WaitOrigin {
  kind: "spawned_wait" | "delegation_wait";
  task_id: RowId;
}

/**
 * Where a row came from: made by hand, or derived — a Habit's occurrence, a wait's check task, a
 * Task's spawned wait or a delegated Task's wait. The few rules that genuinely differ for a derived
 * row key off this and nothing else. Absent reads as `manual`.
 */
export type Origin = { kind: "manual" } | HabitOrigin | CheckOrigin | WaitOrigin;

/** The check `origin` names, if it names one. */
export function checkOrigin(origin: Origin | undefined): CheckOrigin | undefined {
  return origin?.kind === "check" ? origin : undefined;
}

/** The Task a derived wait is drawn from, if `origin` names one. */
export function waitOrigin(origin: Origin | undefined): WaitOrigin | undefined {
  return origin?.kind === "spawned_wait" || origin?.kind === "delegation_wait" ? origin : undefined;
}

/** The Habit occurrence `origin` names, if it names one. */
export function habitOrigin(origin: Origin | undefined): HabitOrigin | undefined {
  return origin?.kind === "habit" ? origin : undefined;
}

/**
 * A derived row was named where only a stored one can be: a Domain, a Flow, a wait, or a copy
 * source. Thrown rather than sending a UUID to a command that takes an integer.
 */
export class NotStoredError extends Error {
  constructor(id: string) {
    super(`Row "${id}" is a Habit occurrence, not a stored row`);
    this.name = "NotStoredError";
  }
}

/** `id` as a stored row's integer id; throws {@link NotStoredError} for a derived one. */
export function storedId(id: RowId): number {
  if (isDerivedId(id)) throw new NotStoredError(id);
  return id;
}
