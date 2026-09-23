import { invoke } from "./gesture";
import type { TimeScope } from "@/api/time-scope";
import type { ExpectationArchival, ExpectationStatus } from "@/api/expectation-status";

/**
 * A **wait**: something outside your own action you are waiting on to be released. Tasks can
 * depend on one, and a pending one blocks them. It has no Time Scope, no Plan and no tags; its one
 * date is the optional check-by: while it is set, a virtual "check on it" task is drawn beneath it.
 */
export interface Expectation {
  id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  status: ExpectationStatus;
  archival: ExpectationArchival;
  check_by: TimeScope | null;
  position: number;
  is_private: boolean;
}

export interface CreateExpectationRequest {
  title: string;
  parent_type: string;
  parent_id: number;
  check_by?: TimeScope;
}

export interface UpdateExpectationRequest {
  title?: string;
  status?: ExpectationStatus;
  archival?: ExpectationArchival;
  // Absent = leave unchanged, null = clear, value = set.
  check_by?: TimeScope | null;
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
 * Completes an expectation's virtual check task: clears its check-by, leaving it pending. Refused
 * when there is no check-by, since there was then no check to complete.
 */
export async function clearExpectationCheckBy(id: number): Promise<Expectation> {
  return invoke<Expectation>("clear_expectation_check_by", { id });
}

/** Deletes an expectation, its notes, and every dependency edge aimed at it. */
export async function deleteExpectation(id: number): Promise<void> {
  return invoke<void>("delete_expectation", { id });
}
