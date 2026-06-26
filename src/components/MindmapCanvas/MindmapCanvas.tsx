import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { animated, to } from "@react-spring/web";
import type { MindmapNode } from "@/utils/tree-layout";
import { usePanZoom } from "@/hooks/use-pan-zoom";
import MindmapTree from "@/components/MindmapTree/MindmapTree";
import type { ContextMenuAction } from "@/components/NodeContextMenu/context-action";

export interface MindmapCanvasHandle {
  centerOnRoot: () => void;
}

interface Props {
  root: MindmapNode;
  collapsedNodeIds: ReadonlySet<string>;
  selectedNodeIds: ReadonlySet<string>;
  editingNodeId: string | null;
  dragTargetId: string | null;
  dragSourceId: string | null;
  canvasOverlay?: ReactNode;
  hasClipboard: boolean;
  onSelect: (id: string | null) => void;
  onCtrlClick?: (id: string) => void;
  onShiftClick?: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onContextAction: (nodeId: string, action: ContextMenuAction) => void;
  onDragStart: (id: string, startX: number, startY: number) => void;
  onCanvasClick: () => void;
  onStatusClick: (id: string) => void;
}

const MindmapCanvas = forwardRef<MindmapCanvasHandle, Props>(function MindmapCanvas({ root, collapsedNodeIds, selectedNodeIds, editingNodeId, dragTargetId, dragSourceId, canvasOverlay, hasClipboard, onSelect, onCtrlClick, onShiftClick, onDoubleClick, onCommitEdit, onCancelEdit, onContextAction, onDragStart, onCanvasClick, onStatusClick }: Props, ref) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { springProps, onMouseDown, centerOnRoot } = usePanZoom(svgRef);
  useImperativeHandle(ref, () => ({ centerOnRoot }), [centerOnRoot]);

  const transform = to(
    [springProps.x, springProps.y, springProps.scale],
    (x, y, s) => `translate(${x}px, ${y}px) scale(${s})`,
  );

  return (
    <animated.svg ref={svgRef} width="100%" height="100%" style={{ background: "var(--canvas-bg)", display: "block", userSelect: "none", direction: "ltr" }} onMouseDown={onMouseDown} onClick={onCanvasClick}>
      <animated.g style={{ transform }}>
        <MindmapTree root={root} collapsedNodeIds={collapsedNodeIds} selectedNodeIds={selectedNodeIds} editingNodeId={editingNodeId} dragTargetId={dragTargetId} dragSourceId={dragSourceId} hasClipboard={hasClipboard} onSelect={onSelect} {...(onCtrlClick !== undefined ? { onCtrlClick } : {})} {...(onShiftClick !== undefined ? { onShiftClick } : {})} onDoubleClick={onDoubleClick} onCommitEdit={onCommitEdit} onCancelEdit={onCancelEdit} onContextAction={onContextAction} onDragStart={onDragStart} onStatusClick={onStatusClick} />
        {canvasOverlay}
      </animated.g>
    </animated.svg>
  );
});

export default MindmapCanvas;
