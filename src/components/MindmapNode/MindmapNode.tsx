import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type { MindmapNode as MindmapNodeData, Position } from "@/utils/tree-layout";
import { isRtlText } from "@/utils/text-direction";
import { computeNodeDimensions, computeEditHeight } from "@/utils/node-meta";
import { computeNodeAppearance } from "@/utils/node-visuals";
import NodeContextMenu from "@/components/NodeContextMenu/NodeContextMenu";
import type { ContextMenuAction } from "@/components/NodeContextMenu/context-action";
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
  onCtrlClick?: (id: string) => void;
  onShiftClick?: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onContextAction: (nodeId: string, action: ContextMenuAction) => void;
  onDragStart: (id: string, startX: number, startY: number) => void;
  onStatusClick?: (id: string) => void;
}

export default function MindmapNode({ node, position, isSelected, isCollapsed, isDragTarget, isDragSource, hasClipboard, isEditing, onSelect, onCtrlClick, onShiftClick, onDoubleClick, onCommitEdit, onCancelEdit, onContextAction, onDragStart, onStatusClick }: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const { width, height, fontSize, iconWidth, lineHeight, lineCount: displayLineCount } = computeNodeDimensions(position.depth, node.title);

  // Tracks visual line count during editing so the node rect expands in real time.
  // React's getDerivedStateFromProps pattern: setting state during render is safe when
  // guarded by a changed-value check (no infinite loop, React re-renders once).
  const [editLineCount, setEditLineCount] = useState(displayLineCount);
  const [wasEditing, setWasEditing] = useState(isEditing);
  if (isEditing !== wasEditing) {
    setWasEditing(isEditing);
    if (isEditing) setEditLineCount(displayLineCount);
  }
  const activeHeight = isEditing ? computeEditHeight(position.depth, editLineCount) : height;

  const iconR = (iconWidth - 8) / 2;
  const { isBlocked, iconColor, iconOpacity, fillColor, fillOpacity, label, textFill, scopeLifecycle, nodeOpacity } = computeNodeAppearance(node, position.depth);
  const isRtl = isRtlText(node.title);
  const iconCx = isRtl ? width - iconWidth / 2 : iconWidth / 2;
  const strokeColor = isSelected
    ? "var(--node-border-selected)"
    : isDragTarget
      ? "var(--accent)"
      : scopeLifecycle === "overdue"
        ? "var(--overdue)"
        : "var(--node-border)";
  const canClickStatus =
    onStatusClick !== undefined &&
    (node.habitIteration !== undefined || (node.kind === "task" && !isBlocked && node.virtual !== true));

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      onCtrlClick?.(node.id);
    } else if (e.shiftKey) {
      onShiftClick?.(node.id);
    } else {
      onSelect(node.id);
    }
  }, [node.id, onSelect, onCtrlClick, onShiftClick]);
  // A virtual node (derived Habit iteration) is read-only: no edit, drag, or context menu.
  const handleDoubleClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); if (node.virtual === true) return; onDoubleClick(node.id); }, [node.id, node.virtual, onDoubleClick]);
  const handleContextMenu = useCallback((e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); if (node.virtual === true) return; setContextMenu({ x: e.clientX, y: e.clientY }); }, [node.virtual]);
  const handleMouseDown = useCallback((e: React.MouseEvent) => { if (e.button !== 0 || node.kind === "aspect" || node.virtual === true) return; onDragStart(node.id, e.clientX, e.clientY); }, [node.id, node.kind, node.virtual, onDragStart]);
  const handleStatusIconClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onSelect(node.id); onStatusClick?.(node.id); }, [node.id, onSelect, onStatusClick]);

  return (
    <g
      data-node-id={node.id}
      transform={`translate(${position.x - width / 2}, ${position.y - activeHeight / 2})`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseDown={handleMouseDown}
      style={{ cursor: "pointer", opacity: isDragSource === true ? 0 : (nodeOpacity === 1 ? undefined : nodeOpacity), pointerEvents: isDragSource === true ? "none" : undefined }}
    >
      <NodeRect node={node} width={width} height={activeHeight} iconWidth={iconWidth} iconCx={iconCx} iconCy={activeHeight / 2} iconR={iconR} fillColor={fillColor} fillOpacity={fillOpacity} strokeColor={strokeColor} isSelected={isSelected} isCollapsed={isCollapsed} iconColor={iconColor} iconOpacity={iconOpacity} isBlocked={isBlocked} canClickStatus={canClickStatus} isRtl={isRtl} onStatusIconClick={handleStatusIconClick} />
      <NodeLabel node={node} isEditing={isEditing} iconWidth={iconWidth} width={width} height={activeHeight} fontSize={fontSize} lineHeight={lineHeight} displayLineCount={displayLineCount} editLineCount={editLineCount} onEditLineCountChange={setEditLineCount} label={label} textFill={textFill} isRtl={isRtl} onCommitEdit={onCommitEdit} onCancelEdit={onCancelEdit} />
      {contextMenu !== null && createPortal(
        <NodeContextMenu x={contextMenu.x} y={contextMenu.y} nodeKind={node.kind} isCollapsed={isCollapsed} hasClipboard={hasClipboard} onAction={(action) => onContextAction(node.id, action)} onClose={() => setContextMenu(null)} />,
        document.body,
      )}
    </g>
  );
}
