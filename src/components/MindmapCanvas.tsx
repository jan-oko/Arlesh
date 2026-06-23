import { useRef } from "react";
import { animated, to } from "@react-spring/web";
import type { MindmapNode } from "@/utils/tree-layout";
import { usePanZoom } from "@/hooks/use-pan-zoom";
import MindmapTree from "./MindmapTree";
import type { ContextMenuAction } from "./NodeContextMenu";

interface Props {
  root: MindmapNode;
  collapsedNodeIds: ReadonlySet<string>;
  selectedNodeId: string | null;
  editingNodeId: string | null;
  dragTargetId: string | null;
  hasClipboard: boolean;
  onSelect: (id: string | null) => void;
  onDoubleClick: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onContextAction: (nodeId: string, action: ContextMenuAction) => void;
  onDragStart: (id: string) => void;
  onDragEnter: (id: string) => void;
  onDragLeave: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (targetId: string) => void;
  onCanvasClick: () => void;
  onStatusClick: (id: string) => void;
}

export default function MindmapCanvas({
  root,
  collapsedNodeIds,
  selectedNodeId,
  editingNodeId,
  dragTargetId,
  hasClipboard,
  onSelect,
  onDoubleClick,
  onCommitEdit,
  onCancelEdit,
  onContextAction,
  onDragStart,
  onDragEnter,
  onDragLeave,
  onDragEnd,
  onDrop,
  onCanvasClick,
  onStatusClick,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { springProps, onMouseDown } = usePanZoom(svgRef);

  const transform = to(
    [springProps.x, springProps.y, springProps.scale],
    (x, y, s) => `translate(${x}px, ${y}px) scale(${s})`,
  );

  return (
    <animated.svg
      ref={svgRef}
      width="100%"
      height="100%"
      style={{ background: "var(--canvas-bg)", display: "block", userSelect: "none" }}
      onMouseDown={onMouseDown}
      onClick={onCanvasClick}
    >
      <animated.g style={{ transform }}>
        <MindmapTree
          root={root}
          collapsedNodeIds={collapsedNodeIds}
          selectedNodeId={selectedNodeId}
          editingNodeId={editingNodeId}
          dragTargetId={dragTargetId}
          hasClipboard={hasClipboard}
          onSelect={onSelect}
          onDoubleClick={onDoubleClick}
          onCommitEdit={onCommitEdit}
          onCancelEdit={onCancelEdit}
          onContextAction={onContextAction}
          onDragStart={onDragStart}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
          onStatusClick={onStatusClick}
        />
      </animated.g>
    </animated.svg>
  );
}
