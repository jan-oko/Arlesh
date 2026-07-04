import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";
import type { ScopeLifecycle } from "@/api/scope-lifecycle";

export interface NodeAppearance {
  isBlocked: boolean;
  iconColor: string;
  iconOpacity: number;
  fillColor: string;
  fillOpacity: number;
  label: string;
  textFill: string;
  /** Derived scope state, when the node has one (Task/Goal). Drives overdue accent / lapsed dim. */
  scopeLifecycle: ScopeLifecycle | undefined;
  /** Whole-node opacity multiplier — Lapsed items are dimmed to read as dropped from the view. */
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

  const nodeOpacity = node.scopeLifecycle === "lapsed" ? 0.45 : 1;

  return {
    isBlocked, iconColor, iconOpacity, fillColor, fillOpacity, label, textFill,
    scopeLifecycle: node.scopeLifecycle, nodeOpacity,
  };
}
