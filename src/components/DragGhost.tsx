import { createPortal } from "react-dom";
import type { MindmapNode } from "@/utils/tree-layout";
import { getNodeSize } from "@/utils/node-meta";
import NodeIcon from "./NodeIcon";

interface Props {
  node: MindmapNode;
  depth: number;
  x: number;
  y: number;
}

export default function DragGhost({ node, depth, x, y }: Props) {
  const { width, height, fontSize, iconWidth, maxChars } = getNodeSize(depth);
  const iconR = (iconWidth - 8) / 2;
  const iconCx = iconWidth / 2;
  const iconCy = height / 2;

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

  return createPortal(
    <svg
      width={width}
      height={height}
      style={{
        position: "fixed",
        left: x - width / 2,
        top: y - height / 2,
        opacity: 0.65,
        pointerEvents: "none",
        overflow: "visible",
        zIndex: 9999,
        filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.35))",
      }}
    >
      <rect
        width={width}
        height={height}
        rx={6}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke="var(--accent)"
        strokeWidth={2}
      />
      <NodeIcon
        kind={node.kind}
        status={node.status}
        isBlocked={isBlocked}
        cx={iconCx}
        cy={iconCy}
        r={iconR}
        color={iconColor}
        opacity={iconOpacity}
      />
      <text
        x={iconWidth + 4}
        y={height / 2}
        dominantBaseline="central"
        fontSize={fontSize}
        fill={textFill}
        style={{ userSelect: "none" }}
      >
        {label}
      </text>
    </svg>,
    document.body,
  );
}
