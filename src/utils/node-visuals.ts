import type { MindmapNode } from "@/utils/tree-layout";

export interface NodeAppearance {
  isBlocked: boolean;
  iconColor: string;
  iconOpacity: number;
  fillColor: string;
  fillOpacity: number;
  label: string;
  textFill: string;
}

export function computeNodeAppearance(node: MindmapNode, depth: number, maxChars: number): NodeAppearance {
  const isBlocked =
    node.kind === "task" &&
    node.blockedReason !== undefined &&
    node.blockedReason !== null &&
    node.blockedReason !== "";

  const iconColor =
    node.kind === "aspect" ? "rgba(255,255,255,0.9)" : (node.color ?? "var(--text-secondary)");

  const iconOpacity = node.kind !== "aspect" && node.color !== undefined ? 0.8 : 1;

  const fillColor = node.color ?? "var(--node-bg)";
  const fillOpacity =
    node.kind !== "aspect" && node.color !== undefined
      ? Math.max(0.15, 0.5 - depth * 0.06)
      : 1;

  const label =
    node.title.length > maxChars ? node.title.slice(0, maxChars - 1) + "…" : node.title;

  const textFill = node.kind === "aspect" ? "rgba(255,255,255,0.9)" : "var(--node-text)";

  return { isBlocked, iconColor, iconOpacity, fillColor, fillOpacity, label, textFill };
}
