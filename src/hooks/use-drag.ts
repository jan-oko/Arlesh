import { useCallback, useEffect, useRef, useState } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import { isValidDropTarget } from "@/utils/node-meta";
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

export function useDrag(
  tree: MindmapNode,
  onDrop: (nodeId: string, targetId: string) => void,
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
      const isDescendant = findNode(source, targetId) !== undefined;
      if (isDescendant) return null;
      return isValidDropTarget(source.kind, target.kind) ? targetId : null;
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
      if (targetId !== null) onDrop(gesture.nodeId, targetId);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [tree, onDrop]);

  return { dragSourceId, dragTargetId, ghostPos, onDragStart };
}
