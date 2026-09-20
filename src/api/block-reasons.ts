import { invoke } from "./gesture";

/** A single explicit block reason on a task or goal. */
export interface BlockReason {
  owner_type: string; // "task" | "goal"
  owner_id: number;
  reason: string;
  position: number;
}

/** Every explicit block reason across all tasks and goals (for the mindmap bulk load). */
export async function listAllBlockReasons(): Promise<BlockReason[]> {
  return invoke<BlockReason[]>("list_all_block_reasons");
}

/** Replaces the ordered block-reason list for one owner (`ownerType` is "task" or "goal"). */
export async function setBlockReasons(ownerType: string, ownerId: number, reasons: string[]): Promise<void> {
  return invoke<void>("set_block_reasons", { ownerType, ownerId, reasons });
}
