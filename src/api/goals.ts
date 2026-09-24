import { invoke } from "./gesture";
import type { TimeScope } from "@/api/time-scope";
import type { OnScopeExit } from "@/api/scope-lifecycle";
import type { Origin, RowId } from "@/api/node-id";

export interface Goal {
  id: RowId;
  title: string;
  parent_type: string;
  parent_id: RowId;
  status: string;
  time_scope: TimeScope | null;
  // Present iff time_scope is (inherited with the window otherwise).
  on_scope_exit: OnScopeExit | null;
  tag_ids: number[];
  position: number;
  is_private: boolean;
  // The bd issue this goal is tracked as; absent when it is tracked as none. Written only by the
  // MCP server — no update request carries it.
  beads_id?: string;
  // Where the row came from: made by hand, or a Habit's occurrence. Absent reads as manual.
  origin?: Origin;
}

export interface CreateGoalRequest {
  title: string;
  parent_type: string;
  parent_id: RowId;
  status?: string;
  time_scope?: TimeScope;
  // Applied only when time_scope is set (defaults to "keep").
  on_scope_exit?: OnScopeExit;
}

export interface UpdateGoalRequest {
  title?: string;
  status?: string;
  // Absent = leave unchanged, null = clear, value = set.
  time_scope?: TimeScope | null;
  // Forced null when the scope is cleared; defaulted to "keep" when a scope is set without one.
  on_scope_exit?: OnScopeExit | null;
  parent_type?: string;
  parent_id?: RowId;
  position?: number;
  is_private?: boolean;
}

export async function getGoal(id: number): Promise<Goal> {
  return invoke<Goal>("get_goal", { id });
}

export async function listGoals(now: string): Promise<Goal[]> {
  return invoke<Goal[]>("list_goals", { now });
}

export async function createGoal(request: CreateGoalRequest): Promise<Goal> {
  return invoke<Goal>("create_goal", { request });
}

/** Updates a goal, stored or derived; `confirmed` answers the unfinished-children question. */
export async function updateGoal(
  id: RowId,
  request: UpdateGoalRequest,
  confirmed?: boolean,
): Promise<Goal> {
  return invoke<Goal>("update_goal", { id, request, confirmed });
}

/** Deletes a goal — or archives a Habit occurrence, which is never deleted. */
export async function deleteGoal(id: RowId): Promise<void> {
  return invoke<void>("delete_goal", { id });
}

export async function duplicateGoal(
  id: number,
  targetType: string,
  targetId: number,
  position: number,
): Promise<Goal> {
  return invoke<Goal>("duplicate_goal", { id, targetType, targetId, position });
}

export async function addTagToGoal(goalId: RowId, tagId: number): Promise<void> {
  return invoke<void>("add_tag_to_goal", { goalId, tagId });
}

export async function removeTagFromGoal(goalId: RowId, tagId: number): Promise<void> {
  return invoke<void>("remove_tag_from_goal", { goalId, tagId });
}
