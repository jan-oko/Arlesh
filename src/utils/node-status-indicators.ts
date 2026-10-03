import type { MindmapNode } from "@/utils/tree-layout";
import { isOccurrence } from "@/utils/node-identity";
import { isAgentic } from "@/utils/agentic";
import { isDelegated } from "@/utils/filter-tree";

/** The status badges that can appear in a node's indicator row, in display order. */
export type StatusIndicatorType =
  | "scope"
  | "archived"
  | "planned"
  | "frozen"
  | "backlog"
  | "agentic"
  | "delegated"
  | "asynchronous"
  | "agentWaiting"
  | "info"
  | "flowInstance"
  | "tags"
  | "mcp"
  | "private";

/** One badge to render below a node. `conflict` applies to `archived` and `planned`; `inherited`
 * only to `planned`.
 *
 * The `scope` clock is drawn the same whatever the window's position. It used to be crossed out
 * with a red X once the window had passed; the user had it removed (2026-10-01, "remove the red x
 * over the clock status for tasks past scope"): an Overdue item says so with its amber border, and a
 * Missed or Completed one with the archive box. */
export interface StatusIndicator {
  type: StatusIndicatorType;
  /** For `archived`: this effective archival came from a scope Resolution overriding a
   * manually-set Frozen status. */
  conflict?: boolean;
  /** For `planned`: the Plan is inherited from a planned node above, not the node's own — drawn
   * fainter. */
  inherited?: boolean;
}

function hasInfoDetails(node: MindmapNode): boolean {
  return node.kind === "info" && node.infoDetails != null && node.infoDetails !== "";
}

/** A node that came from a flow: a Start-flow instance, or a Habit occurrence. */
function isFlowInstance(node: MindmapNode): boolean {
  return node.fromFlow === true || isOccurrence(node);
}

/**
 * The ordered status badges to render below `node`. Pure and synchronous: it decides *which*
 * badges appear from the node's own fields; the human-readable scope/plan/tag tooltips are
 * resolved by the rendering component (they need async scope lookups).
 */
export function deriveStatusIndicators(node: MindmapNode): StatusIndicator[] {
  const indicators: StatusIndicator[] = [];

  if (node.timeScope != null) {
    indicators.push({ type: "scope" });
  }
  if (node.status === "archived" || node.archived === true) {
    indicators.push({ type: "archived", conflict: node.archivalConflict === true });
  }
  // Its effective Plan: its own, or — badged fainter — one it inherits. A Task breaking a plan rule
  // is flagged on the same badge: one the writer never leaves, but an undo or older data can.
  if (node.plan != null) {
    indicators.push({ type: "planned", conflict: node.planConflict !== undefined });
  } else if (node.inheritedPlan !== undefined || node.planConflict !== undefined) {
    indicators.push({ type: "planned", inherited: true, conflict: node.planConflict !== undefined });
  }
  if (node.status === "frozen") {
    indicators.push({ type: "frozen" });
  }
  // Deliberately distinct from the Frozen snowflake: Backlog and Frozen are separate states, and a
  // glance at the canvas should say which one a node is in. Read off the stored flag, so a
  // backlogged task whose window has lapsed shows both this and the archive box — the same pairing
  // a Frozen goal already gets under a forced Archived.
  if (node.backlogged === true) {
    indicators.push({ type: "backlog" });
  }
  // Read through `isAgentic`, so a Task that inherited the flag from an ancestor is badged exactly
  // like one that carries it itself — the flag says the work suits an agent either way, and a
  // branch marked in one edit would otherwise look unmarked everywhere below the node it was set on.
  if (isAgentic(node)) {
    indicators.push({ type: "agentic" });
  }
  // Who holds it, beside whether it suits an agent: the two are independent, and a Task may carry
  // both. The Task's own delegate — delegation does not inherit.
  if (isDelegated(node)) {
    indicators.push({ type: "delegated" });
  }
  // Read off the node's own flag and nothing else. Agentic is badged through `isAgentic` because it
  // inherits; this one does not, so a subtask of a Task that starts a wait shows no hourglass — it
  // is usually the work done *after* the wait, and badging it would say the opposite.
  if (node.asynchronous === true) {
    indicators.push({ type: "asynchronous" });
  }
  // An agentic wait: an agent raised it on the Task it is working and is waiting on the user. The
  // bot head, because it is the agent that is waiting; the tooltip carries its question.
  if (node.agentWaiting !== undefined) {
    indicators.push({ type: "agentWaiting" });
  }
  // No verdict badge. A Commitment's glyph carries its Verdict itself — hollow while the answer
  // is owed, solid once given, cleft when broken, struck through when the Verdict Window ran out
  // — so a badge underneath would state the same fact a few pixels away. Every other indicator
  // here says something the glyph does not.
  if (hasInfoDetails(node)) {
    indicators.push({ type: "info" });
  }
  if (isFlowInstance(node)) {
    indicators.push({ type: "flowInstance" });
  }
  if (node.tagIds.length > 0) {
    indicators.push({ type: "tags" });
  }
  // One state only: the MCP can see this node. Whether it may also write it is not a second
  // badge — inside a root, write is exactly Agentic, which the bot head above already says.
  if (node.mcpVisibleVia !== undefined) {
    indicators.push({ type: "mcp" });
  }
  // The node's own flag and never an ancestor's. Privacy does act on the whole subtree — Private
  // Mode hides a private node with everything under it — but that is filtering, not a state of each
  // node beneath: the flag is set, and unset, on one node only, and the badge says where. Badging
  // the subtree too would mark every row under a private branch alike, hiding the one that holds
  // the switch. It sits in the antenna's slot: the MCP never sees a private node, so the two never
  // share a row on the same node.
  if (node.isPrivate === true) {
    indicators.push({ type: "private" });
  }

  return indicators;
}
