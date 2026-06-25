import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type { MindmapNode as MindmapNodeData, Position } from "@/utils/tree-layout";
import { isRtlText } from "@/utils/text-direction";
import { computeNodeDimensions } from "@/utils/node-meta";
import { computeNodeAppearance } from "@/utils/node-visuals";
import NodeContextMenu, { type ContextMenuAction } from "@/components/NodeContextMenu/NodeContextMenu";
import NodeRect from "./NodeRect";
import NodeLabel from "./NodeLabel";

interface Props {
  node: MindmapNodeData;
  position: Position;
  isSelected: boolean;
  isCollapsed: boolean;
  isDragTarget: boolean;
  isDragSource?: boolean;
  hasClipboard: boolean;
  isEditing: boolean;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onContextAction: (nodeId: string, action: ContextMenuAction) => void;
  onDragStart: (id: string, startX: number, startY: number) => void;
  onStatusClick?: (id: string) => void;
}

export default function MindmapNode({ node, position, isSelected, isCollapsed, isDragTarget, isDragSource, hasClipboard, isEditing, onSelect, onDoubleClick, onCommitEdit, onCancelEdit, onContextAction, onDragStart, onStatusClick }: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const { width, height, fontSize, iconWidth } = computeNodeDimensions(position.depth, node.title);
  const iconR = (iconWidth - 8) / 2;
  const { isBlocked, iconColor, iconOpacity, fillColor, fillOpacity, label, textFill } = computeNodeAppearance(node, position.depth);
  const isRtl = isRtlText(node.title);
  const iconCx = isRtl ? width - iconWidth / 2 : iconWidth / 2;
  const strokeColor = isSelected ? "var(--node-border-selected)" : isDragTarget ? "var(--accent)" : "var(--node-border)";
  const canClickStatus = node.kind === "task" && !isBlocked && onStatusClick !== undefined;

  const handleClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onSelect(node.id); }, [node.id, onSelect]);
  const handleDoubleClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onDoubleClick(node.id); }, [node.id, onDoubleClick]);
  const handleContextMenu = useCallback((e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY }); }, []);
  const handleMouseDown = useCallback((e: React.MouseEvent) => { if (e.button !== 0 || node.kind === "aspect") return; onDragStart(node.id, e.clientX, e.clientY); }, [node.id, node.kind, onDragStart]);
  const handleStatusIconClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onSelect(node.id); onStatusClick?.(node.id); }, [node.id, onSelect, onStatusClick]);

  return (
    <g
      data-node-id={node.id}
      transform={`translate(${position.x - width / 2}, ${position.y - height / 2})`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseDown={handleMouseDown}
      style={{ cursor: "pointer", opacity: isDragSource === true ? 0 : undefined, pointerEvents: isDragSource === true ? "none" : undefined }}
    >
      <NodeRect node={node} width={width} height={height} iconWidth={iconWidth} iconCx={iconCx} iconCy={height / 2} iconR={iconR} fillColor={fillColor} fillOpacity={fillOpacity} strokeColor={strokeColor} isSelected={isSelected} isCollapsed={isCollapsed} iconColor={iconColor} iconOpacity={iconOpacity} isBlocked={isBlocked} canClickStatus={canClickStatus} isRtl={isRtl} onStatusIconClick={handleStatusIconClick} />
      <NodeLabel node={node} isEditing={isEditing} iconWidth={iconWidth} width={width} height={height} fontSize={fontSize} label={label} textFill={textFill} isRtl={isRtl} onCommitEdit={onCommitEdit} onCancelEdit={onCancelEdit} />
      {contextMenu !== null && createPortal(
        <NodeContextMenu x={contextMenu.x} y={contextMenu.y} nodeKind={node.kind} isCollapsed={isCollapsed} hasClipboard={hasClipboard} onAction={(action) => onContextAction(node.id, action)} onClose={() => setContextMenu(null)} />,
        document.body,
      )}
    </g>
  );
}
