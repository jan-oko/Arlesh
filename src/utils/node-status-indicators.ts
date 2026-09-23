import type { MindmapNode } from "@/utils/tree-layout";
import { isAgentic } from "@/utils/agentic";

/** The status badges that can appear in a node's indicator row, in display order. */
export type StatusIndicatorType =
  | "scope"
  | "overdue"
  | "archived"
  | "planned"
  | "frozen"
  | "backlog"
  | "agentic"
  | "asynchronous"
  | "info"
  | "flowInstance"
  | "tags";

/** One badge to render below a node. `outOfScope` applies only to the `scope` clock; `conflict`
 * only to `archived`; `overridden` and `unplanned` only to `planned`. */
export interface StatusIndicator {
  type: StatusIndicatorType;
  /** For `scope`: the relevance window has passed, so the clock is drawn crossed-out. */
  outOfScope?: boolean;
  /** For `archived`: this effective archival came from a scope Resolution overriding a
   * manually-set Frozen status. */
  conflict?: boolean;
  /** For `planned`: a Habit occurrence's Plan is its own, not its Cycle Plan. */
  overridden?: boolean;
  /** For `planned`: a Habit occurrence deliberately left unplanned — drawn struck through. */
  unplanned?: boolean;
}

/**
 * The calendar badge, if any. A Habit occurrence planned on its own is marked as such, and one
 * deliberately left unplanned keeps a struck-through badge, so it cannot be mistaken for an
 * occurrence nobody touched.
 */
function planIndicator(node: MindmapNode): StatusIndicator | null {
  const overridden = node.planOverridden === true;
  if (node.plan != null) return overridden ? { type: "planned", overridden } : { type: "planned" };
  if (overridden) return { type: "planned", overridden, unplanned: true };
  return null;
}

/** A scoped item whose window has passed. */
function isPastWindow(node: MindmapNode): boolean {
  return node.timing === "lapsed";
}

function hasInfoDetails(node: MindmapNode): boolean {
  return node.kind === "info" && node.infoDetails != null && node.infoDetails !== "";
}

/** A node that came from a flow: a real Start-flow instance, or a virtual Habit instance. */
function isFlowInstance(node: MindmapNode): boolean {
  return node.fromFlow === true || node.habitItem !== undefined;
}

/**
 * The ordered status badges to render below `node`. Pure and synchronous: it decides *which*
 * badges appear from the node's own fields; the human-readable scope/plan/tag tooltips are
 * resolved by the rendering component (they need async scope lookups).
 */
export function deriveStatusIndicators(node: MindmapNode): StatusIndicator[] {
  const indicators: StatusIndicator[] = [];

  if (node.timeScope != null) {
    indicators.push({ type: "scope", outOfScope: isPastWindow(node) });
  }
  if (node.resolution === "overdue") {
    indicators.push({ type: "overdue" });
  }
  if (node.status === "archived" || node.archived === true) {
    indicators.push({ type: "archived", conflict: node.archivalConflict === true });
  }
  const plan = planIndicator(node);
  if (plan !== null) {
    indicators.push(plan);
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
  // Read off the node's own flag and nothing else. Agentic is badged through `isAgentic` because it
  // inherits; this one does not, so a subtask of a Task that starts a wait shows no hourglass — it
  // is usually the work done *after* the wait, and badging it would say the opposite.
  if (node.asynchronous === true) {
    indicators.push({ type: "asynchronous" });
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

  return indicators;
}
