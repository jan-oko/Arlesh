import { invoke } from "./gesture";
import type { RowId } from "./node-id";

/**
 * The gesture operations: a gesture the app makes over several nodes, as **one** command — one
 * transaction, one Gesture, one undo step, in Standalone and against a server alike (see
 * docs/spec/client-mode.md, *Undo*).
 */

/** One node a gesture acts on: its kind as the board names it, and its id. */
export interface GestureNode {
  kind: string;
  id: RowId;
}

/** Deletes every node in `nodes`, all or nothing. */
export async function deleteNodes(nodes: GestureNode[]): Promise<void> {
  await invoke<null>("delete_nodes", { nodes });
}
