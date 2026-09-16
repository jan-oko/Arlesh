import { invoke } from "@tauri-apps/api/core";
import type { TimeScope } from "@/api/time-scope";
import type { OnScopeExit } from "@/api/scope-lifecycle";

export interface Task {
  id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  status: string;
  delegate_to: number | null;
  time_scope: TimeScope | null;
  // Present iff time_scope is (inherited with the window otherwise).
  on_scope_exit: OnScopeExit | null;
  plan: TimeScope | null;
  tag_ids: number[];
  position: number;
  is_private: boolean;
  // The bd issue this task is tracked as; absent when it is tracked as none. Written only by the
  // MCP server — no update request carries it.
  beads_id?: string;
}

export interface CreateTaskRequest {
  title: string;
  parent_type: string;
  parent_id: number;
  status?: string;
  time_scope?: TimeScope;
  // Applied only when time_scope is set (defaults to "keep").
  on_scope_exit?: OnScopeExit;
  plan?: TimeScope;
}

export interface UpdateTaskRequest {
  title?: string;
  status?: string;
  delegate_to?: number | null;
  // Absent = leave unchanged, null = clear, value = set.
  time_scope?: TimeScope | null;
  // Forced null when the scope is cleared; defaulted to "keep" when a scope is set without one.
  on_scope_exit?: OnScopeExit | null;
  plan?: TimeScope | null;
  parent_type?: string;
  parent_id?: number;
  position?: number;
  is_private?: boolean;
}

export async function listTasks(): Promise<Task[]> {
  return invoke<Task[]>("list_tasks");
}

export async function createTask(request: CreateTaskRequest): Promise<Task> {
  return invoke<Task>("create_task", { request });
}

export async function updateTask(id: number, request: UpdateTaskRequest): Promise<Task> {
  return invoke<Task>("update_task", { id, request });
}

export async function deleteTask(id: number): Promise<void> {
  return invoke<void>("delete_task", { id });
}

export interface ViolatingDescendant {
  node_type: string;
  node_id: number;
}

export interface ReparentConflicts {
  ancestor_time_scope: TimeScope | null;
  conflicts: ViolatingDescendant[];
}

/**
 * Items a reparent of `node` under `newParent` would orphan, plus the ancestor Time Scope to
 * clamp them to. Call before a drag reparent to drive a clamp-or-cancel prompt.
 */
export async function reparentScopeConflicts(
  nodeType: string,
  nodeId: number,
  newParentType: string,
  newParentId: number,
): Promise<ReparentConflicts> {
  return invoke<ReparentConflicts>("reparent_scope_conflicts", {
    nodeType,
    nodeId,
    newParentType,
    newParentId,
  });
}

/**
 * Descendants a candidate Time Scope would orphan (their explicit window would fall outside it).
 * Call before narrowing a node's scope or reparenting to drive a clamp-or-cancel prompt.
 */
export async function scopeContainmentConflicts(
  nodeType: string,
  nodeId: number,
  timeScope: TimeScope,
): Promise<ViolatingDescendant[]> {
  return invoke<ViolatingDescendant[]>("scope_containment_conflicts", {
    nodeType,
    nodeId,
    timeScope,
  });
}

export type Dependency =
  | { type: "task"; id: number }
  | { type: "goal"; id: number };

export interface TaskWithBlockers {
  task: Task;
  block_reasons: string[];
}

export async function getTask(id: number): Promise<TaskWithBlockers> {
  return invoke<TaskWithBlockers>("get_task", { id });
}

export async function listTaskDependencies(taskId: number): Promise<Dependency[]> {
  return invoke<Dependency[]>("list_task_dependencies", { taskId });
}

/** A single dependency edge: `task_id` depends on `(dependency_type, dependency_id)`. */
export interface TaskDependencyEdge {
  task_id: number;
  dependency_type: string; // "task" | "goal"
  dependency_id: number;
}

/** Every task-dependency edge (for the mindmap bulk load / virtual block-reason derivation). */
export async function listAllTaskDependencies(): Promise<TaskDependencyEdge[]> {
  return invoke<TaskDependencyEdge[]>("list_all_task_dependencies");
}

export async function addTaskDependency(taskId: number, dependency: Dependency): Promise<void> {
  return invoke<void>("add_task_dependency", { taskId, dependency });
}

export async function removeTaskDependency(taskId: number, dependency: Dependency): Promise<void> {
  return invoke<void>("remove_task_dependency", { taskId, dependency });
}

export async function addTagToTask(taskId: number, tagId: number): Promise<void> {
  return invoke<void>("add_tag_to_task", { taskId, tagId });
}

export async function removeTagFromTask(taskId: number, tagId: number): Promise<void> {
  return invoke<void>("remove_tag_from_task", { taskId, tagId });
}
