import { invoke } from "@tauri-apps/api/core";

export interface Domain {
  id: number;
  title: string;
  description: string | null;
  subtype: string;
  parent_id: number | null;
  color: string | null;
  status: string | null;
  knowledge_base_directory: string | null;
}

export interface CreateDomainRequest {
  title: string;
  description: string | null;
  subtype: string;
  parent_id: number | null;
  status: string | null;
  knowledge_base_directory: string | null;
}

export interface UpdateDomainRequest {
  title?: string;
  description?: string;
  parent_id?: number;
  subtype?: string;
  status?: string;
  knowledge_base_directory?: string;
}

export async function listDomains(subtype?: string): Promise<Domain[]> {
  return invoke<Domain[]>("list_domains", { subtype: subtype ?? null });
}

export async function createDomain(request: CreateDomainRequest): Promise<Domain> {
  return invoke<Domain>("create_domain", { request });
}

export async function updateDomain(id: number, request: UpdateDomainRequest): Promise<Domain> {
  return invoke<Domain>("update_domain", { id, request });
}

export async function deleteDomain(id: number): Promise<void> {
  return invoke<void>("delete_domain", { id });
}
