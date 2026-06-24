import { createPortal } from "react-dom";
import type { MindmapNode } from "@/utils/tree-layout";
import { getNodeSize } from "@/utils/node-meta";
import { computeNodeAppearance } from "@/utils/node-visuals";
import NodeIcon from "@/components/NodeIcon/NodeIcon";

interface Props {
  node: MindmapNode;
  depth: number;
  x: number;
  y: number;
}

export default function DragGhost({ node, depth, x, y }: Props) {
  const { width, height, fontSize, iconWidth, maxChars } = getNodeSize(depth);
  const { isBlocked, iconColor, iconOpacity, fillColor, fillOpacity, label, textFill } = computeNodeAppearance(node, depth, maxChars);

  return createPortal(
    <svg
      width={width}
      height={height}
      style={{ position: "fixed", left: x - width / 2, top: y - height / 2, opacity: 0.65, pointerEvents: "none", overflow: "visible", zIndex: 9999, filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.35))" }}
    >
      <rect width={width} height={height} rx={6} fill={fillColor} fillOpacity={fillOpacity} stroke="var(--accent)" strokeWidth={2} />
      <NodeIcon kind={node.kind} status={node.status} isBlocked={isBlocked} cx={iconWidth / 2} cy={height / 2} r={(iconWidth - 8) / 2} color={iconColor} opacity={iconOpacity} />
      <text x={iconWidth + 4} y={height / 2} dominantBaseline="central" fontSize={fontSize} fill={textFill} style={{ userSelect: "none" }}>
        {label}
      </text>
    </svg>,
    document.body,
  );
}
