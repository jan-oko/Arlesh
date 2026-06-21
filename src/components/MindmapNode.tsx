import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MindmapNode as MindmapNodeData, Position } from "@/utils/tree-layout";
import { NODE_ICON, getNodeSize } from "@/utils/node-meta";
import NodeContextMenu, { type ContextMenuAction } from "./NodeContextMenu";

interface Props {
  node: MindmapNodeData;
  position: Position;
  isSelected: boolean;
  isCollapsed: boolean;
  isDragTarget: boolean;
  hasClipboard: boolean;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  isEditing: boolean;
  onContextAction: (nodeId: string, action: ContextMenuAction) => void;
  onDragStart: (id: string) => void;
  onDrop: (targetId: string) => void;
}

export default function MindmapNode({
  node,
  position,
  isSelected,
  isCollapsed,
  isDragTarget,
  hasClipboard,
  onSelect,
  onDoubleClick,
  onCommitEdit,
  onCancelEdit,
  isEditing,
  onContextAction,
  onDragStart,
  onDrop,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { width, height, fontSize, iconWidth, maxChars } = getNodeSize(position.depth);

  useEffect(() => {
    if (!isEditing) return;
    // Defer one tick so WebKit finishes painting the foreignObject before we focus.
    const id = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(id);
  }, [isEditing]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(node.id);
    },
    [node.id, onSelect],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDoubleClick(node.id);
    },
    [node.id, onDoubleClick],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    [],
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        onCommitEdit(node.id, event.currentTarget.value);
      }
      if (event.key === "Escape") {
        onCancelEdit();
      }
    },
    [node.id, onCommitEdit, onCancelEdit],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      onDrop(node.id);
    },
    [node.id, onDrop],
  );

  const fillColor = node.color ?? "var(--node-bg)";
  // Fade inherited aspect color at increasing depths so children don't overpower the aspect itself.
  const fillOpacity =
    node.kind !== "aspect" && node.color !== undefined
      ? Math.max(0.15, 0.5 - position.depth * 0.06)
      : 1;

  const strokeColor = isSelected
    ? "var(--node-border-selected)"
    : isDragTarget
      ? "var(--accent)"
      : "var(--node-border)";

  const label = node.title.length > maxChars
    ? node.title.slice(0, maxChars - 1) + "…"
    : node.title;

  const textFill = node.kind === "aspect" ? "rgba(255,255,255,0.9)" : "var(--node-text)";
  const iconFill = node.kind === "aspect" ? "rgba(255,255,255,0.9)" : "var(--text-secondary)";

  return (
    <g
      transform={`translate(${position.x - width / 2}, ${position.y - height / 2})`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onDragStart={() => onDragStart(node.id)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      draggable={node.kind !== "aspect"}
      style={{ cursor: "pointer" }}
    >
      <rect
        width={width}
        height={height}
        rx={6}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={isSelected ? 2 : 1}
      />

      <text
        x={iconWidth / 2}
        y={height / 2}
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={fontSize}
        fill={iconFill}
      >
        {NODE_ICON[node.kind]}
      </text>

      {isEditing ? (
        <foreignObject x={iconWidth} y={2} width={width - iconWidth - 4} height={height - 4}>
          <input
            ref={inputRef}
            defaultValue={node.title}
            onKeyDown={handleInputKeyDown}
            onBlur={(e) => onCommitEdit(node.id, e.currentTarget.value)}
            style={{
              width: "100%",
              height: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              fontSize,
              padding: "0 2px",
            }}
          />
        </foreignObject>
      ) : (
        <text
          x={iconWidth + 4}
          y={height / 2}
          dominantBaseline="central"
          fontSize={fontSize}
          fill={textFill}
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {label}
        </text>
      )}

      {isCollapsed && node.children.length > 0 && (
        <circle
          cx={width - 6}
          cy={height / 2}
          r={4}
          fill="var(--text-secondary)"
        />
      )}

      {contextMenu !== null && createPortal(
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeKind={node.kind}
          isCollapsed={isCollapsed}
          hasClipboard={hasClipboard}
          onAction={(action) => onContextAction(node.id, action)}
          onClose={() => setContextMenu(null)}
        />,
        document.body,
      )}
    </g>
  );
}
