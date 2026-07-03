import { invoke } from "@tauri-apps/api/core";

/** What happens to a scoped item once its Time Scope has fully passed unfinished. */
export type OnScopeExit = "archive" | "keep";

/** Derived scope state of a Task/Goal at a reference instant (never persisted). */
export type ScopeLifecycle = "active" | "overdue" | "lapsed";

/** One item's derived scope lifecycle, keyed by node reference. */
export interface ItemLifecycle {
  node_type: string;
  node_id: number;
  state: ScopeLifecycle;
}

/**
 * Derives the scope lifecycle of every Task and Goal at `now` (a local wall-clock datetime,
 * ISO `YYYY-MM-DDTHH:MM:SS`). Pure — nothing is persisted.
 */
export async function deriveScopeLifecycles(now: string): Promise<ItemLifecycle[]> {
  return invoke<ItemLifecycle[]>("derive_scope_lifecycles", { now });
}
