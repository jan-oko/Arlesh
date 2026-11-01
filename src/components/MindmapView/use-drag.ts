import { useCallback, useEffect, useRef, useState } from "react";
import { can } from "@/utils/capabilities";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { canAdoptExistingChild } from "@/utils/node-meta";
import { findNode } from "@/utils/mindmap-tree";

const DRAG_THRESHOLD = 4;

interface DragGesture {
  nodeId: string;
  startX: number;
  startY: number;
  committed: boolean;
}

export interface DragState {
  dragSourceId: string | null;
  dragTargetId: string | null;
  ghostPos: { x: number; y: number } | null;
}

interface Options {
  tree: MindmapNode;
  moveNode: (id: string, kind: NodeKind, parentId: string, parentKind: NodeKind, position: number) => Promise<void>;
}

/** The drag's three steps, as a pointer other than the mouse drives them — a finger, on a touchscreen. */
export interface DragControls {
  onDragStart: (id: string, startX: number, startY: number) => void;
  /** The pointer is at `(x, y)`: commits the drag once it has moved far enough, and lights the target. */
  onDragMove: (x: number, y: number) => void;
  /** The pointer let go at `(x, y)`: drops onto the target there, if it takes the node. */
  onDragEnd: (x: number, y: number) => void;
}

export function useDrag(
  { tree, moveNode }: Options,
): DragState & DragControls {
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  // The move and drop steps, rebuilt with the tree they resolve targets in; the mouse listeners and
  // the touch controls below both call the current ones.
  const stepsRef = useRef<{ moveTo: (x: number, y: number) => void; endAt: (x: number, y: number) => void } | null>(null);
  const onDragMove = useCallback((x: number, y: number) => stepsRef.current?.moveTo(x, y), []);
  const onDragEnd = useCallback((x: number, y: number) => stepsRef.current?.endAt(x, y), []);

  const onDragStart = useCallback((id: string, startX: number, startY: number) => {
    gestureRef.current = { nodeId: id, startX, startY, committed: false };
  }, []);

  useEffect(() => {
    function nodeIdAtPoint(x: number, y: number): string | null {
      const el = document.elementFromPoint(x, y);
      return el?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
    }

    function resolveTarget(gesture: DragGesture, x: number, y: number): string | null {
      const targetId = nodeIdAtPoint(x, y);
      if (targetId === null || targetId === gesture.nodeId) return null;
      const source = findNode(tree, gesture.nodeId);
      const target = findNode(tree, targetId);
      if (source === undefined || target === undefined) return null;
      if (findNode(source, targetId) !== undefined) return null;
      // A drag says "not here" by not lighting the node up, which is the whole gesture's own
      // feedback and is on screen the entire time it is wrong — so this is the one place a refusal
      // needs no toast. What it must not do is offer a drop the write cannot make: a **virtual**
      // node has no row whose parent link a move could re-point, on either side of the drop.
      if (source.virtual === true || !can(source, "drag")) return null;
      return canAdoptExistingChild(target, source.kind) ? targetId : null;
    }

    function executeDrop(gesture: DragGesture, targetId: string) {
      const source = findNode(tree, gesture.nodeId);
      const target = findNode(tree, targetId);
      if (source === undefined || target === undefined) return;
      const positions = target.children.filter((c) => c.id !== gesture.nodeId).map((c) => c.position);
      const lastPos = positions.length > 0 ? Math.max(...positions) + 1 : 0;
      void moveNode(gesture.nodeId, source.kind, targetId, target.kind, lastPos);
    }

    function moveTo(x: number, y: number) {
      const gesture = gestureRef.current;
      if (gesture === null) return;
      if (!gesture.committed) {
        if (Math.hypot(x - gesture.startX, y - gesture.startY) < DRAG_THRESHOLD) return;
        gesture.committed = true;
        setDragSourceId(gesture.nodeId);
        document.body.style.cursor = "grabbing";
      }
      setGhostPos({ x, y });
      setDragTargetId(resolveTarget(gesture, x, y));
    }

    function endAt(x: number, y: number) {
      const gesture = gestureRef.current;
      if (gesture === null) return;
      gestureRef.current = null;
      document.body.style.cursor = "";
      setDragSourceId(null);
      setGhostPos(null);
      setDragTargetId(null);
      if (!gesture.committed) return;
      const targetId = resolveTarget(gesture, x, y);
      if (targetId !== null) executeDrop(gesture, targetId);
    }

    stepsRef.current = { moveTo, endAt };
    const handleMouseMove = (e: MouseEvent) => moveTo(e.clientX, e.clientY);
    const handleMouseUp = (e: MouseEvent) => endAt(e.clientX, e.clientY);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [tree, moveNode]);

  return { dragSourceId, dragTargetId, ghostPos, onDragStart, onDragMove, onDragEnd };
}
