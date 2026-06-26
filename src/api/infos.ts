import { invoke } from "@tauri-apps/api/core";

export interface Info {
  id: number;
  body: string;
  parent_type: string;
  parent_id: number;
  position: number;
}

export interface CreateInfoRequest {
  body: string;
  parent_type: string;
  parent_id: number;
  position: number;
}

export interface UpdateInfoRequest {
  body?: string;
  position?: number;
  parent_type?: string;
  parent_id?: number;
}

export async function listInfos(): Promise<Info[]> {
  return invoke<Info[]>("list_infos");
}

export async function createInfo(request: CreateInfoRequest): Promise<Info> {
  return invoke<Info>("create_info", { request });
}

export async function updateInfo(id: number, request: UpdateInfoRequest): Promise<Info> {
  return invoke<Info>("update_info", { id, request });
}

export async function deleteInfo(id: number): Promise<void> {
  return invoke<void>("delete_info", { id });
}
