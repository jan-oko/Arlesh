import { createPortal } from "react-dom";
import type { MindmapNode } from "@/utils/tree-layout";
import { computeNodeDimensions } from "@/utils/node-meta";
import { computeNodeAppearance } from "@/utils/node-visuals";
import { isRtlText } from "@/utils/text-direction";
import NodeIcon from "@/components/NodeIcon/NodeIcon";

interface Props {
  node: MindmapNode;
  depth: number;
  x: number;
  y: number;
}

export default function DragGhost({ node, depth, x, y }: Props) {
  const { width, height, fontSize, iconWidth } = computeNodeDimensions(depth, node.title);
  const { isBlocked, iconColor, iconOpacity, fillColor, fillOpacity, textFill } = computeNodeAppearance(node, depth);
  const isRtl = isRtlText(node.title);
  const iconCx = isRtl ? width - iconWidth / 2 : iconWidth / 2;
  const textX = isRtl ? 4 : iconWidth;
  const textAreaWidth = width - iconWidth - 4;

  return createPortal(
    <svg
      width={width}
      height={height}
      style={{ position: "fixed", left: x - width / 2, top: y - height / 2, opacity: 0.65, pointerEvents: "none", overflow: "visible", zIndex: 9999, filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.35))", direction: "ltr" }}
    >
      <rect width={width} height={height} rx={6} fill={fillColor} fillOpacity={fillOpacity} stroke="var(--accent)" strokeWidth={2} />
      <NodeIcon kind={node.kind} status={node.status} isBlocked={isBlocked} cx={iconCx} cy={height / 2} r={(iconWidth - 8) / 2} color={iconColor} opacity={iconOpacity} />
      <foreignObject x={textX} y={4} width={textAreaWidth} height={height - 8} pointerEvents="none">
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", fontSize, color: textFill, fontFamily: "var(--font-sans)", whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "none", lineHeight: 1.3, direction: isRtl ? "rtl" : "ltr" }}>
          {node.title}
        </div>
      </foreignObject>
    </svg>,
    document.body,
  );
}
