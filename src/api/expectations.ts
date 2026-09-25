import { invoke } from "./gesture";
import type { DurationSpec, TimeScope } from "@/api/time-scope";
import type { ExpectationArchival, ExpectationStatus } from "@/api/expectation-status";
import type { Origin, RowId } from "@/api/node-id";

/**
 * A **wait**: something outside your own action you are waiting on to be released. Tasks can
 * depend on one, and a pending one blocks them. It has a Time Scope and tags like a Task, but no
 * Plan; it may carry a Check every, while which a "check on it" task is drawn beneath it — due at its
 * Starting, then one interval after each check made. Each check task is a Task row (`origin`
 * `check`). A Task's spawned wait and a delegated Task's wait are Expectation rows with UUID ids and
 * origins of their own (ADR 0008).
 */
export interface Expectation {
  id: RowId;
  title: string;
  parent_type: string;
  parent_id: RowId;
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
  /** Raised by an agent on the Agentic Task it hangs under: "the agent is waiting on you". The
   * backend always sends it; absent reads as false. */
  agentic?: boolean;
  /** The agent's question, or what it is waiting on. */
  agentic_note?: string | null;
  /** Whether an agentic wait is a question for the user (released only with an answer), rather
   * than a wait on something non-human such as CI. Absent reads as true. */
  question?: boolean;
  /** The answer a question wait was, or is being, released with. */
  answer?: string | null;
  /** Where the row came from; absent reads as `manual`. */
  origin?: Origin;
}

export interface CreateExpectationRequest {
  title: string;
  parent_type: string;
  parent_id: RowId;
  check_every?: DurationSpec;
  check_starting?: string;
  time_scope?: TimeScope;
  // Refused unless the parent is a Task that reads as Agentic.
  agentic?: boolean;
  agentic_note?: string;
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
  parent_id?: RowId;
  position?: number;
  is_private?: boolean;
  agentic?: boolean;
  // Absent = leave unchanged, null = clear, value = set.
  agentic_note?: string | null;
  // Absent = leave unchanged, null = clear, value = set. Releasing a question wait needs one.
  answer?: string | null;
}

export async function listExpectations(now: string): Promise<Expectation[]> {
  return invoke<Expectation[]>("list_expectations", { now });
}

export async function createExpectation(request: CreateExpectationRequest): Promise<Expectation> {
  return invoke<Expectation>("create_expectation", { request });
}

/** Updates a wait. A Task's spawned wait takes its status and archive; a delegated Task's wait
 * takes nothing — it is released by the Task being done. */
export async function updateExpectation(id: RowId, request: UpdateExpectationRequest): Promise<Expectation> {
  return invoke<Expectation>("update_expectation", { id, request });
}

export async function addTagToExpectation(expectationId: RowId, tagId: number): Promise<void> {
  return invoke<void>("add_tag_to_expectation", { expectationId, tagId });
}

export async function removeTagFromExpectation(expectationId: RowId, tagId: number): Promise<void> {
  return invoke<void>("remove_tag_from_expectation", { expectationId, tagId });
}

/** Deletes a stored wait, its notes, and every dependency edge aimed at it. */
export async function deleteExpectation(id: RowId): Promise<void> {
  return invoke<void>("delete_expectation", { id });
}
