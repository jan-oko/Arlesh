import type { MindmapNode } from "@/utils/tree-layout";
import type { Verdict } from "@/api/commitments";
import { VERDICT } from "@/api/commitments";

/** The status badges that can appear in a node's indicator row, in display order. */
export type StatusIndicatorType =
  | "scope"
  | "overdue"
  | "archived"
  | "planned"
  | "frozen"
  | "backlog"
  | "kept"
  | "broken"
  | "unresolved"
  | "info"
  | "flowInstance"
  | "tags";

/** One badge to render below a node. `outOfScope` applies only to the `scope` clock; `conflict`
 * only to `archived`. */
export interface StatusIndicator {
  type: StatusIndicatorType;
  /** For `scope`: the relevance window has passed, so the clock is drawn crossed-out. */
  outOfScope?: boolean;
  /** For `archived`: this effective archival came from a scope Resolution overriding a
   * manually-set Frozen status. */
  conflict?: boolean;
}

/** A scoped item whose window has passed. */
function isPastWindow(node: MindmapNode): boolean {
  return node.timing === "lapsed";
}

function hasInfoDetails(node: MindmapNode): boolean {
  return node.kind === "info" && node.infoDetails != null && node.infoDetails !== "";
}

/** The badge a Commitment's verdict reads as. An absent verdict is `unresolved`, not nothing:
 * the two would otherwise be indistinguishable on the canvas. */
function verdictBadge(verdict: Verdict | undefined): "kept" | "broken" | "unresolved" {
  if (verdict === VERDICT.KEPT) return "kept";
  if (verdict === VERDICT.BROKEN) return "broken";
  return "unresolved";
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
  if (node.plan != null) {
    indicators.push({ type: "planned" });
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
  // A Commitment always shows where its verdict stands, including when it stands nowhere: an
  // unjudged commitment is the one thing the user most needs to see, and leaving the row blank
  // would make "not yet said" look like "nothing to say".
  if (node.kind === "commitment") {
    indicators.push({ type: verdictBadge(node.verdict) });
  }
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
