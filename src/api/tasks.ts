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

export async function addTagToTask(taskId: number, tagId: number): Promise<void> {
  return invoke<void>("add_tag_to_task", { taskId, tagId });
}

export async function removeTagFromTask(taskId: number, tagId: number): Promise<void> {
  return invoke<void>("remove_tag_from_task", { taskId, tagId });
}
