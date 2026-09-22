import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";
import { pathToNode } from "@/utils/mindmap-tree";
import type { Resolution } from "@/api/scope-lifecycle";

/** Opacity for a node the view is showing but the filter is not asking for: an archived item, or one
 * held on screen only by the focus exemption. Dim enough to read as dropped, legible enough to act on. */
export const DIMMED_OPACITY = 0.45;

export interface NodeAppearance {
  isBlocked: boolean;
  iconColor: string;
  iconOpacity: number;
  fillColor: string;
  fillOpacity: number;
  label: string;
  textFill: string;
  /** Derived resolution outcome, once the node's scope has lapsed (Task/Goal only). Drives the
   * overdue accent border. */
  resolution: Resolution | undefined;
  /** Whole-node opacity multiplier — archived items are dimmed to read as dropped from the view. */
  nodeOpacity: number;
}

export function computeNodeAppearance(node: MindmapNode, depth: number): NodeAppearance {
  const isBlocked = isNodeBlocked(node);

  const iconColor =
    node.kind === "aspect" ? "rgba(255,255,255,0.9)" : (node.color ?? "var(--text-secondary)");

  const iconOpacity = node.kind !== "aspect" && node.color !== undefined ? 0.8 : 1;

  const fillColor = node.color ?? "var(--node-bg)";
  const fillOpacity =
    node.kind !== "aspect" && node.color !== undefined
      ? Math.max(0.15, 0.5 - depth * 0.06)
      : 1;

  const label = node.title;

  const textFill = node.kind === "aspect" ? "rgba(255,255,255,0.9)" : "var(--node-text)";

  const nodeOpacity = node.archived === true ? DIMMED_OPACITY : 1;

  return {
    isBlocked, iconColor, iconOpacity, fillColor, fillOpacity, label, textFill,
    resolution: node.resolution, nodeOpacity,
  };
}

/**
 * The status tints a card's fill is drawn from, in the order a node is matched against them.
 *
 * They are CSS custom properties rather than colours, so the theme decides the value and this file
 * decides only the meaning.
 */
export type StatusTint =
  | "--tint-blocked"
  | "--tint-archived"
  | "--tint-frozen"
  | "--tint-done"
  | "--tint-progress"
  | "--tint-open";

/**
 * What a card's fill says: **the state the work is in**.
 *
 * It used to say how deep the node sat — the aspect's colour at an opacity falling off with depth.
 * That was two mistakes at once. Depth is the one thing a Steps card never needs to encode, because
 * a Step *is* one depth; and a fill taken from an arbitrary node colour at an arbitrary opacity has
 * no contrast guarantee against the text on top of it, which is why an Aspect card — drawn at full
 * strength by that rule — was unreadable in both themes.
 *
 * The order is the order the facts override each other, and it is the interesting part:
 *
 *   1. **Blocked** first. It is the most actionable thing a card can say, and it is true regardless
 *      of what the stored status claims.
 *   2. **Archived** next, because the model already lets a lapsed scope force it over a stored
 *      status — the card agrees with the model rather than with the field.
 *   3. **Frozen**, a deliberate hold, which outranks whatever progress was made before it.
 *   4. **Done**, then **in progress**, then everything else.
 *
 * A **Commitment** is matched on its Verdict rather than a status it does not have: broken reads
 * like blocked, kept like done, unanswered like open. A structural container — Aspect, Domain,
 * Project, Tag — has no state of its own to show and reads open, which is also what finally lets an
 * Aspect card be legible.
 */
export function statusTint(node: MindmapNode): StatusTint {
  if (isNodeBlocked(node)) return "--tint-blocked";
  if (node.status === "archived" || node.archived === true) return "--tint-archived";
  if (node.status === "frozen") return "--tint-frozen";
  if (node.kind === "commitment") {
    if (node.verdict === "broken") return "--tint-blocked";
    if (node.verdict === "kept") return "--tint-done";
    return "--tint-open";
  }
  if (node.status === "done" || node.status === "achieved") return "--tint-done";
  if (node.status === "in_progress") return "--tint-progress";
  return "--tint-open";
}

/** The status tint as the `var(...)` a style attribute can carry. */
export function statusTintValue(node: MindmapNode): string {
  return `var(${statusTint(node)})`;
}

/**
 * The colour of the aspect `id` lives under, or `undefined` outside any of them.
 *
 * A node's own `color` is already the aspect's, propagated down on load — but only where it was
 * set, and a node that carries none needs its ancestors asked. One walk down answers both.
 */
export function aspectColorOf(root: MindmapNode, id: string): string | undefined {
  const path = pathToNode(root, id);
  for (let i = path.length - 1; i >= 0; i--) {
    const color = path[i]?.color;
    if (color !== undefined) return color;
  }
  return undefined;
}
