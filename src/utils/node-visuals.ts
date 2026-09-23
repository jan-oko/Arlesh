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

/** The style properties that wash a card in its aspect's colour. */
export interface AspectWashStyle {
  "--card-aspect"?: string;
  "--card-aspect-strength"?: string;
}

/**
 * The hues that take a wash strength of their own, keyed by the seeded aspect colour.
 *
 * Self (`#bdc3c7`) and Flow (`#95a5a6`) are both near-neutral greys, and at the shared strength their
 * washes were indistinguishable. The strengths themselves are per theme, so they live in
 * `tokens.css`; this only says which hue takes which. Keyed by colour rather than by aspect because
 * what needs tuning is how a hue mixes, and the six aspect colours are fixed with the board.
 */
const WASH_STRENGTH_BY_COLOUR: ReadonlyMap<string, string> = new Map([
  ["#bdc3c7", "var(--card-aspect-strength-self)"],
  ["#95a5a6", "var(--card-aspect-strength-flow)"],
]);

/**
 * What a card needs to be washed in `aspectColor` — see `aspect-wash.module.css`, which the card's
 * class composes. Outside any aspect it is empty, which leaves the card its plain base surface.
 */
export function aspectWashStyle(aspectColor: string | undefined): AspectWashStyle {
  if (aspectColor === undefined) return {};
  const strength = WASH_STRENGTH_BY_COLOUR.get(aspectColor.toLowerCase());
  return strength === undefined
    ? { "--card-aspect": aspectColor }
    : { "--card-aspect": aspectColor, "--card-aspect-strength": strength };
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
