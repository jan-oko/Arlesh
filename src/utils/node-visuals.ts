import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";
import type { Resolution } from "@/api/scope-lifecycle";

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

  const nodeOpacity = node.archived === true ? 0.45 : 1;

  return {
    isBlocked, iconColor, iconOpacity, fillColor, fillOpacity, label, textFill,
    resolution: node.resolution, nodeOpacity,
  };
}
