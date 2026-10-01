import { invoke } from "./gesture";
import type { RowId } from "@/api/node-id";

/** A single explicit block reason on a task or goal. */
export interface BlockReason {
  owner_type: string; // "task" | "goal"
  owner_id: RowId;
  reason: string;
  position: number;
  /**
   * Present on a reason the backend **derived** rather than stored. No one wrote it and no editor
   * removes it. `agent_capacity`: the agent capacity lock is on and the owner is an Agentic Task not
   * yet Done; only clearing the lock removes it. `compound`: the owner is a Compound Task and every
   * one of its open sub-items is blocked; it goes when a sub-item is unblocked or finished.
   */
  derived?: "agent_capacity" | "compound";
}

/** Every explicit block reason across all tasks and goals (for the mindmap bulk load). */
export async function listAllBlockReasons(): Promise<BlockReason[]> {
  return invoke<BlockReason[]>("list_all_block_reasons");
}

/** Replaces the ordered block-reason list for one owner (`ownerType` is "task" or "goal"). */
export async function setBlockReasons(ownerType: string, ownerId: RowId, reasons: string[]): Promise<void> {
  return invoke<void>("set_block_reasons", { ownerType, ownerId, reasons });
}
