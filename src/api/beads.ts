import { invoke } from "./gesture";

/**
 * The node kinds that can carry a `bd` issue link.
 *
 * The same four the MCP server's `arlesh_beads` tool names. A Domain, Aspect or Tag has no issue
 * link and is not one of them — `"project"` is the `project` subtype of Domain, and the backend
 * refuses any other subtype rather than clearing a column that was never set.
 */
export type BeadsNodeType = "task" | "goal" | "commitment" | "project";

export const BEADS_NODE_TYPE = {
  TASK: "task",
  GOAL: "goal",
  COMMITMENT: "commitment",
  PROJECT: "project",
} as const;

/**
 * Drops the `bd` issue link a node carries. The issue itself is untouched — `bd` owns it, and this
 * only removes Arlesh's mirror of which one the node belongs to.
 *
 * The **only** write on that column this app can make. Authoring and editing a link stay MCP-only,
 * because the UI has no way to produce an id `bd` issued; clearing needs no such value, which is
 * the whole reason it is carved out. No update request gained a beads field for it.
 *
 * Clearing a node that carries no link is not an error. An unknown node is.
 */
export async function clearBeadsId(nodeType: BeadsNodeType, nodeId: number): Promise<void> {
  return invoke<void>("clear_beads_id", { nodeType, nodeId });
}
