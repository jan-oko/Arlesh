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
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onContextAction: (nodeId: string, action: ContextMenuAction) => void;
  onDragStart: (id: string) => void;
  onDrop: (targetId: string) => void;
  onCanvasClick: () => void;
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
  onDrop,
  onCanvasClick,
}: Props) {
  const { springProps, bind } = usePanZoom();

  const transform = to(
    [springProps.x, springProps.y, springProps.scale],
    (x, y, s) => `translate(${x}px, ${y}px) scale(${s})`,
  );

  return (
    <animated.svg
      {...bind()}
      width="100%"
      height="100%"
      style={{
        background: "var(--canvas-bg)",
        display: "block",
        touchAction: "none",
      }}
      onClick={onCanvasClick}
    >
      <animated.g style={{ transform, transformOrigin: "50% 50%" }}>
        <g transform="translate(50%, 50%)">
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
            onDrop={onDrop}
          />
        </g>
      </animated.g>
    </animated.svg>
  );
}
