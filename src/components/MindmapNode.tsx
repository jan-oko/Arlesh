import { useCallback, useEffect, useRef, useState } from "react";
import type { MindmapNode as MindmapNodeData, Position } from "@/utils/tree-layout";
import { NODE_ICON } from "@/utils/node-meta";
import NodeContextMenu, { type ContextMenuAction } from "./NodeContextMenu";

const NODE_WIDTH = 160;
const NODE_HEIGHT = 36;
const FONT_SIZE = 13;
const ICON_WIDTH = 20;

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

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
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

  const fillColor = node.kind === "aspect" && node.color !== undefined
    ? node.color
    : "var(--node-bg)";

  const strokeColor = isSelected
    ? "var(--node-border-selected)"
    : isDragTarget
      ? "var(--accent)"
      : "var(--node-border)";

  return (
    <g
      transform={`translate(${position.x}, ${position.y})`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onDoubleClick(node.id)}
      onContextMenu={handleContextMenu}
      onDragStart={() => onDragStart(node.id)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      draggable={node.kind !== "aspect"}
      style={{ cursor: "pointer" }}
    >
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={6}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={isSelected ? 2 : 1}
      />

      <text
        x={ICON_WIDTH / 2}
        y={NODE_HEIGHT / 2}
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={FONT_SIZE}
        fill={node.kind === "aspect" ? "rgba(255,255,255,0.9)" : "var(--text-secondary)"}
      >
        {NODE_ICON[node.kind]}
      </text>

      {isEditing ? (
        <foreignObject x={ICON_WIDTH} y={2} width={NODE_WIDTH - ICON_WIDTH - 4} height={NODE_HEIGHT - 4}>
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
              fontSize: FONT_SIZE,
              padding: "0 2px",
            }}
          />
        </foreignObject>
      ) : (
        <text
          x={ICON_WIDTH + 4}
          y={NODE_HEIGHT / 2}
          dominantBaseline="central"
          fontSize={FONT_SIZE}
          fill={node.kind === "aspect" ? "rgba(255,255,255,0.9)" : "var(--node-text)"}
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {node.title.length > 16 ? node.title.slice(0, 15) + "…" : node.title}
        </text>
      )}

      {isCollapsed && node.children.length > 0 && (
        <circle
          cx={NODE_WIDTH - 6}
          cy={NODE_HEIGHT / 2}
          r={4}
          fill="var(--text-secondary)"
        />
      )}

      {contextMenu !== null && (
        <foreignObject x={-9999} y={-9999} width={1} height={1} overflow="visible">
          <NodeContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            nodeKind={node.kind}
            isCollapsed={isCollapsed}
            hasClipboard={hasClipboard}
            onAction={(action) => onContextAction(node.id, action)}
            onClose={() => setContextMenu(null)}
          />
        </foreignObject>
      )}
    </g>
  );
}
