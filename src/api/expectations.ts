import { invoke } from "./gesture";
import type { DurationSpec, TimeScope } from "@/api/time-scope";
import type { ExpectationArchival, ExpectationStatus } from "@/api/expectation-status";

/**
 * A **wait**: something outside your own action you are waiting on to be released. Tasks can
 * depend on one, and a pending one blocks them. It has a Time Scope and tags like a Task, but no
 * Plan; it may carry a Check every, while which a virtual "check on it" task is drawn beneath it —
 * due at its Starting, then one interval after each check made.
 */
export interface Expectation {
  id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  status: ExpectationStatus;
  archival: ExpectationArchival;
  check_every?: DurationSpec;
  // ISO `YYYY-MM-DDTHH:MM:SS`, local time.
  check_starting?: string;
  last_check_at?: string;
  /** Its own relevance window, like a Task's — separate from its Check every. */
  time_scope: TimeScope | null;
  tag_ids: number[];
  position: number;
  is_private: boolean;
}

export interface CreateExpectationRequest {
  title: string;
  parent_type: string;
  parent_id: number;
  check_every?: DurationSpec;
  check_starting?: string;
  time_scope?: TimeScope;
}

export interface UpdateExpectationRequest {
  title?: string;
  status?: ExpectationStatus;
  archival?: ExpectationArchival;
  // Absent = leave unchanged, null = stop checking, value = set (starting now unless named).
  check_every?: DurationSpec | null;
  check_starting?: string;
  // Absent = leave unchanged, null = clear, value = set.
  time_scope?: TimeScope | null;
  parent_type?: string;
  parent_id?: number;
  position?: number;
  is_private?: boolean;
}

export async function listExpectations(): Promise<Expectation[]> {
  return invoke<Expectation[]>("list_expectations");
}

export async function createExpectation(request: CreateExpectationRequest): Promise<Expectation> {
  return invoke<Expectation>("create_expectation", { request });
}

export async function updateExpectation(id: number, request: UpdateExpectationRequest): Promise<Expectation> {
  return invoke<Expectation>("update_expectation", { id, request });
}

/**
 * Completes the current check on a stored wait: records now as its last check, so the next falls due
 * one interval later. Refused when no check is due.
 */
export async function completeExpectationCheck(id: number): Promise<Expectation> {
  return invoke<Expectation>("complete_expectation_check", { id });
}

/**
 * A check on a stored wait: the one due and open (no `resolved_at`), or one completed, which stays
 * on the board as a done check task.
 */
export interface ExpectationCheck {
  expectation_id: number;
  /** The Day it fell due on. */
  due: TimeScope;
  /** When it fell due, `YYYY-MM-DDTHH:MM:SS` — which check it is. */
  due_at: string;
  resolved_at?: string;
}

/** A completed check on a spawned wait. */
export interface DoneCheck {
  due: TimeScope;
  due_at: string;
  resolved_at: string;
}

/** The overlay of the wait an Asynchronous task's completion spawned, as the views draw it. */
export interface SpawnedWaitView {
  task_id: number;
  /** When the task was completed; absent when that was never recorded. */
  spawned_at?: string;
  status: ExpectationStatus;
  archival: ExpectationArchival;
  last_check_at?: string;
  /** The template's Time Scope rule, counted from the day it began. */
  time_scope?: TimeScope;
  /** The Day its current check fell due on, while one is due and open. */
  next_check?: TimeScope;
  next_check_at?: string;
  /** Its completed checks during this completion of the task, oldest first. */
  done_checks: DoneCheck[];
}

/** Releases, un-releases or archives the wait a task's completion spawned. */
export async function updateSpawnedWait(
  taskId: number,
  request: { status?: ExpectationStatus; archival?: ExpectationArchival },
): Promise<void> {
  await invoke<unknown>("update_spawned_wait", { taskId, request });
}

/** Takes the latest completed check on a stored wait back; refused for any other. */
export async function reopenExpectationCheck(id: number, dueAt: string): Promise<Expectation> {
  return invoke<Expectation>("reopen_expectation_check", { id, dueAt });
}

/** Takes the latest completed check on a task's spawned wait back; refused for any other. */
export async function reopenSpawnedWaitCheck(taskId: number, dueAt: string): Promise<void> {
  return invoke<void>("reopen_spawned_wait_check", { taskId, dueAt });
}

/** Completes the current check on a task's spawned wait. */
export async function completeSpawnedWaitCheck(taskId: number): Promise<void> {
  return invoke<void>("complete_spawned_wait_check", { taskId });
}

export async function addTagToExpectation(expectationId: number, tagId: number): Promise<void> {
  return invoke<void>("add_tag_to_expectation", { expectationId, tagId });
}

export async function removeTagFromExpectation(expectationId: number, tagId: number): Promise<void> {
  return invoke<void>("remove_tag_from_expectation", { expectationId, tagId });
}

/** Deletes an expectation, its notes, and every dependency edge aimed at it. */
export async function deleteExpectation(id: number): Promise<void> {
  return invoke<void>("delete_expectation", { id });
}
