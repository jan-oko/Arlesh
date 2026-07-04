import { invoke } from "@tauri-apps/api/core";
import type { TimeScope } from "@/api/time-scope";
import type { OnScopeExit } from "@/api/scope-lifecycle";

export interface Goal {
  id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  status: string;
  time_scope: TimeScope | null;
  // Present iff time_scope is (inherited with the window otherwise).
  on_scope_exit: OnScopeExit | null;
  tag_ids: number[];
  position: number;
  nsfw: boolean;
}

export interface CreateGoalRequest {
  title: string;
  parent_type: string;
  parent_id: number;
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
  parent_id?: number;
  position?: number;
  nsfw?: boolean;
}

export async function getGoal(id: number): Promise<Goal> {
  return invoke<Goal>("get_goal", { id });
}

export async function listGoals(): Promise<Goal[]> {
  return invoke<Goal[]>("list_goals");
}

export async function createGoal(request: CreateGoalRequest): Promise<Goal> {
  return invoke<Goal>("create_goal", { request });
}

export async function updateGoal(id: number, request: UpdateGoalRequest): Promise<Goal> {
  return invoke<Goal>("update_goal", { id, request });
}

export async function deleteGoal(id: number): Promise<void> {
  return invoke<void>("delete_goal", { id });
}

export async function addTagToGoal(goalId: number, tagId: number): Promise<void> {
  return invoke<void>("add_tag_to_goal", { goalId, tagId });
}

export async function removeTagFromGoal(goalId: number, tagId: number): Promise<void> {
  return invoke<void>("remove_tag_from_goal", { goalId, tagId });
}
