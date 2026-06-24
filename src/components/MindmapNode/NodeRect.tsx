import NodeIcon from "@/components/NodeIcon/NodeIcon";
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
  onStatusIconClick: (e: React.MouseEvent) => void;
}

export default function NodeRect({ node, width, height, iconWidth, iconCx, iconCy, iconR, fillColor, fillOpacity, strokeColor, isSelected, isCollapsed, iconColor, iconOpacity, isBlocked, canClickStatus, onStatusIconClick }: Props) {
  return (
    <>
      <rect width={width} height={height} rx={6} fill={fillColor} fillOpacity={fillOpacity} stroke={strokeColor} strokeWidth={isSelected ? 2 : 1} />
      <NodeIcon kind={node.kind} status={node.status} isBlocked={isBlocked} cx={iconCx} cy={iconCy} r={iconR} color={iconColor} opacity={iconOpacity} />
      {canClickStatus && (
        <rect x={0} y={0} width={iconWidth} height={height} fill="transparent" style={{ cursor: "pointer" }} onClick={onStatusIconClick} />
      )}
      {isCollapsed && node.children.length > 0 && (
        <circle cx={width - 6} cy={height / 2} r={4} fill="var(--text-secondary)" />
      )}
    </>
  );
}
