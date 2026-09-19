import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { animated, to } from "@react-spring/web";
import type { MindmapNode, Orientation } from "@/utils/tree-layout";
import { usePanZoom } from "@/hooks/use-pan-zoom";
import MindmapTree from "@/components/MindmapTree/MindmapTree";
import type { ContextMenuAction } from "@/components/NodeContextMenu/context-action";
import styles from "./MindmapCanvas.module.css";

import type { Viewport } from "@/hooks/use-pan-zoom";

export interface MindmapCanvasHandle {
  centerOnRoot: () => void;
  /** Pans so the given layout point sits at the viewport centre (e.g. centering on a selected node). */
  centerOnPoint: (lx: number, ly: number) => void;
  /** Pans to a layout point only if it's currently off-screen (for follow-the-selection). */
  ensureVisible: (lx: number, ly: number) => void;
  /** Pans by a screen-pixel offset (e.g. keyboard-driven panning when no node is focused). */
  panBy: (dx: number, dy: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Current transform + viewport size, for the "is anything visible" check. */
  getViewport: () => Viewport;
}

interface Props {
  root: MindmapNode;
  orientation: Orientation;
  collapsedNodeIds: ReadonlySet<string>;
  selectedNodeIds: ReadonlySet<string>;
  /** Nodes on screen only by the focus exemption — the filter would have dropped them, so they render dimmed. */
  focusExemptIds: ReadonlySet<string>;
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

const MindmapCanvas = forwardRef<MindmapCanvasHandle, Props>(function MindmapCanvas({ root, orientation, collapsedNodeIds, selectedNodeIds, focusExemptIds, editingNodeId, dragTargetId, dragSourceId, canvasOverlay, hasClipboard, onSelect, onCtrlClick, onShiftClick, onDoubleClick, onCommitEdit, onCancelEdit, onContextAction, onDragStart, onCanvasClick, onStatusClick }: Props, ref) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { springProps, onMouseDown, centerOnRoot, centerOnPoint, ensureVisible, panBy, zoomIn, zoomOut, getViewport } = usePanZoom(svgRef);
  useImperativeHandle(ref, () => ({ centerOnRoot, centerOnPoint, ensureVisible, panBy, zoomIn, zoomOut, getViewport }), [centerOnRoot, centerOnPoint, ensureVisible, panBy, zoomIn, zoomOut, getViewport]);

  const transform = to(
    [springProps.x, springProps.y, springProps.scale],
    (x, y, s) => `translate(${x}px, ${y}px) scale(${s})`,
  );

  return (
    <animated.svg ref={svgRef} className={styles.canvas} width="100%" height="100%" onMouseDown={onMouseDown} onClick={onCanvasClick}>
      <animated.g style={{ transform }}>
        <MindmapTree root={root} orientation={orientation} collapsedNodeIds={collapsedNodeIds} selectedNodeIds={selectedNodeIds} focusExemptIds={focusExemptIds} editingNodeId={editingNodeId} dragTargetId={dragTargetId} dragSourceId={dragSourceId} hasClipboard={hasClipboard} onSelect={onSelect} {...(onCtrlClick !== undefined ? { onCtrlClick } : {})} {...(onShiftClick !== undefined ? { onShiftClick } : {})} onDoubleClick={onDoubleClick} onCommitEdit={onCommitEdit} onCancelEdit={onCancelEdit} onContextAction={onContextAction} onDragStart={onDragStart} onStatusClick={onStatusClick} />
        {canvasOverlay}
      </animated.g>
    </animated.svg>
  );
});

export default MindmapCanvas;
