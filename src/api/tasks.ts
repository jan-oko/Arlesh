import { invoke } from "@tauri-apps/api/core";

export interface Task {
  id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  status: string;
  blocked_reason: string | null;
  delegate_to: number | null;
  scope_id: number | null;
  tag_ids: number[];
  position: number;
}

export interface CreateTaskRequest {
  title: string;
  parent_type: string;
  parent_id: number;
  status?: string;
  scope_id?: number;
}

export interface UpdateTaskRequest {
  title?: string;
  status?: string;
  blocked_reason?: string;
  delegate_to?: number | null;
  scope_id?: number | null;
  parent_type?: string;
  parent_id?: number;
  position?: number;
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
