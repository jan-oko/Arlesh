import { useCallback, useEffect, useRef, useState } from "react";
import { isDerivedWait } from "@/utils/derived-wait";
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

export function useDrag(
  { tree, moveNode }: Options,
): DragState & { onDragStart: (id: string, startX: number, startY: number) => void } {
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);

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
      if (source.virtual === true || isDerivedWait(source)) return null;
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

    function handleMouseMove(e: MouseEvent) {
      const gesture = gestureRef.current;
      if (gesture === null) return;
      if (!gesture.committed) {
        if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < DRAG_THRESHOLD) return;
        gesture.committed = true;
        setDragSourceId(gesture.nodeId);
        document.body.style.cursor = "grabbing";
      }
      setGhostPos({ x: e.clientX, y: e.clientY });
      setDragTargetId(resolveTarget(gesture, e.clientX, e.clientY));
    }

    function handleMouseUp(e: MouseEvent) {
      const gesture = gestureRef.current;
      if (gesture === null) return;
      gestureRef.current = null;
      document.body.style.cursor = "";
      setDragSourceId(null);
      setGhostPos(null);
      setDragTargetId(null);
      if (!gesture.committed) return;
      const targetId = resolveTarget(gesture, e.clientX, e.clientY);
      if (targetId !== null) executeDrop(gesture, targetId);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [tree, moveNode]);

  return { dragSourceId, dragTargetId, ghostPos, onDragStart };
}
