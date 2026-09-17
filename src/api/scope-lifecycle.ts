import { invoke } from "@tauri-apps/api/core";

/** What happens to a scoped item once its Time Scope has fully passed unfinished. */
export type OnScopeExit = "archive" | "keep";

/** An item's window position relative to "now" (never persisted). Independent of resolution —
 * unscoped items are always "active". */
export type Timing = "pending" | "active" | "lapsed";

/** Only meaningful once `Timing` is "lapsed": how the item was resolved by then. */
export type Resolution = "completed" | "missed" | "overdue";

/** An item's effective archived/frozen/live state. "frozen" is Goal/Project-only and "backlog"
 * Task-only; both lose to "archived" when a lapsed window forces it. */
export type Archival = "live" | "frozen" | "backlog" | "archived";

/** One Task/Goal's derived lifecycle state, keyed by node reference. `resolution` is present only
 * when `timing` is "lapsed". `archival_conflict` is true when a manually-set Frozen status, or a
 * Task's stored Backlog, was overridden because `resolution` forced `archival` to "archived". */
export interface ItemLifecycle {
  node_type: string;
  node_id: number;
  timing: Timing;
  resolution?: Resolution;
  archival: Archival;
  archival_conflict: boolean;
}

/**
 * Derives the lifecycle (Timing/Resolution/effective Archival) of every Task and Goal at `now`
 * (a local wall-clock datetime, ISO `YYYY-MM-DDTHH:MM:SS`). Pure — nothing is persisted.
 */
export async function deriveScopeLifecycles(now: string): Promise<ItemLifecycle[]> {
  return invoke<ItemLifecycle[]>("derive_scope_lifecycles", { now });
}
