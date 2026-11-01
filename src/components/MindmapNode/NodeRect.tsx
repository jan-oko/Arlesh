import NodeIcon from "@/components/NodeIcon/NodeIcon";
import { useHasTouch } from "@/hooks/use-media-query";
import type { MindmapNode } from "@/utils/tree-layout";

interface Props {
  node: MindmapNode;
  width: number;
  height: number;
  iconWidth: number;
  iconCx: number;
  iconCy: number;
  iconR: number;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  isSelected: boolean;
  isCollapsed: boolean;
  iconColor: string;
  iconOpacity: number;
  isBlocked: boolean;
  canClickStatus: boolean;
  isRtl: boolean;
  onStatusIconClick: (e: React.MouseEvent) => void;
}

export default function NodeRect({ node, width, height, iconWidth, iconCx, iconCy, iconR, fillColor, fillOpacity, strokeColor, isSelected, isCollapsed, iconColor, iconOpacity, isBlocked, canClickStatus, isRtl, onStatusIconClick }: Props) {
  const statusRectX = isRtl ? width - iconWidth : 0;
  const collapsedDotCx = isRtl ? 6 : width - 6;
  // On a touchscreen every node with children carries the dot — hollow while it is open — and a tap
  // on it folds or unfolds the node (docs/spec/touch.md). The view listens for the tap on
  // `data-collapse-dot`; the hit circle is a fingertip wide, and the node's gestures leave it alone.
  const hasTouch = useHasTouch();
  const hasChildren = node.children.length > 0;
  return (
    <>
      <rect width={width} height={height} rx={6} fill={fillColor} fillOpacity={fillOpacity} stroke={strokeColor} strokeWidth={isSelected ? 2 : 1} />
      <NodeIcon kind={node.kind} status={node.status} verdict={node.verdict} expired={node.expired === true} isBlocked={isBlocked} isHabit={node.flow?.isHabit === true} compound={node.compound === true} cx={iconCx} cy={iconCy} r={iconR} color={iconColor} opacity={iconOpacity} />
      {canClickStatus && (
        <rect x={statusRectX} y={0} width={iconWidth} height={height} fill="transparent" cursor="pointer" data-gesture-skip="" onClick={onStatusIconClick} />
      )}
      {isCollapsed && hasChildren && !hasTouch && (
        <circle cx={collapsedDotCx} cy={height / 2} r={4} fill="var(--text-secondary)" />
      )}
      {hasTouch && hasChildren && (
        <g data-collapse-dot={node.id} data-gesture-skip="">
          <circle cx={collapsedDotCx} cy={height / 2} r={4} fill={isCollapsed ? "var(--text-secondary)" : "none"} stroke="var(--text-secondary)" strokeWidth={1.5} />
          <circle cx={collapsedDotCx} cy={height / 2} r={14} fill="transparent" />
        </g>
      )}
    </>
  );
}
