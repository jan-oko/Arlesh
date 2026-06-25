import { useEffect } from "react";
import type { MindmapNode } from "@/utils/tree-layout";

type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

interface ClipboardEntry {
  operation: "cut" | "copy";
  nodeId: string;
}

interface Options {
  isInputActive: boolean;
  isWarningActive: boolean;
  onDismissWarning: () => void;
  selectedNodeId: string | null;
  subtreeRootId: string | null;
  clipboard: ClipboardEntry | null;
  onNavigate: (key: ArrowKey) => void;
  onCycleType: (id: string, dir: 1 | -1) => void;
  onReorder: (id: string, dir: 1 | -1) => void;
  onStartRename: (id: string) => void;
  onCreateChild: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
  onCycleStatus: (id: string) => void;
  onDeselect: () => void;
  onExitSubtree: () => void;
  onExitToRoot: () => void;
  onCut: (id: string) => void;
  onCopy: (id: string) => void;
  onPaste: (id: string) => void;
  findNodeById: (id: string) => MindmapNode | undefined;
}

export function useKeyboardMindmap(options: Options): void {
  const {
    isInputActive, isWarningActive, onDismissWarning,
    selectedNodeId, subtreeRootId, clipboard,
    onNavigate, onCycleType, onReorder, onStartRename,
    onCreateChild, onDelete, onToggleCollapsed, onCycleStatus,
    onDeselect, onExitSubtree, onExitToRoot, onCut, onCopy, onPaste,
    findNodeById,
  } = options;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isInputActive) return;

      if (isWarningActive) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          onDismissWarning();
        }
        return;
      }

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          onNavigate("ArrowLeft");
          break;
        case "ArrowRight":
          event.preventDefault();
          onNavigate("ArrowRight");
          break;
        case "ArrowUp":
          event.preventDefault();
          if (event.ctrlKey && selectedNodeId !== null) onCycleType(selectedNodeId, -1);
          else if (event.altKey && selectedNodeId !== null) onReorder(selectedNodeId, -1);
          else onNavigate("ArrowUp");
          break;
        case "ArrowDown":
          event.preventDefault();
          if (event.ctrlKey && selectedNodeId !== null) onCycleType(selectedNodeId, 1);
          else if (event.altKey && selectedNodeId !== null) onReorder(selectedNodeId, 1);
          else onNavigate("ArrowDown");
          break;
        case "F2":
          event.preventDefault();
          if (selectedNodeId !== null) {
            const node = findNodeById(selectedNodeId);
            if (node !== undefined && node.kind !== "aspect") onStartRename(selectedNodeId);
          }
          break;
        case "Tab": {
          event.preventDefault();
          if (selectedNodeId !== null) {
            const node = findNodeById(selectedNodeId);
            if (node !== undefined && node.id.includes("-") && node.kind !== "tag") {
              onCreateChild(selectedNodeId);
            }
          }
          break;
        }
        case "Enter": {
          if (selectedNodeId !== null) {
            const node = findNodeById(selectedNodeId);
            const isBlocked = node !== undefined && node.kind === "task" &&
              node.blockedReason !== undefined && node.blockedReason !== null && node.blockedReason !== "";
            if (node !== undefined && node.kind === "task" && !isBlocked) {
              event.preventDefault();
              onCycleStatus(selectedNodeId);
            }
          }
          break;
        }
        case "Delete":
          if (selectedNodeId !== null) {
            event.preventDefault();
            onDelete(selectedNodeId);
          }
          break;
        case "/":
          if (event.ctrlKey && selectedNodeId !== null) {
            event.preventDefault();
            onToggleCollapsed(selectedNodeId);
          }
          break;
        case "Escape":
          if (event.ctrlKey && subtreeRootId !== null) {
            event.preventDefault();
            onExitToRoot();
          } else if (event.shiftKey && subtreeRootId !== null) {
            event.preventDefault();
            onExitSubtree();
          } else if (selectedNodeId !== null) {
            event.preventDefault();
            onDeselect();
          }
          break;
        case "x":
          if (event.ctrlKey && selectedNodeId !== null) {
            event.preventDefault();
            onCut(selectedNodeId);
          }
          break;
        case "c":
          if (event.ctrlKey && selectedNodeId !== null) {
            event.preventDefault();
            onCopy(selectedNodeId);
          }
          break;
        case "v":
          if (event.ctrlKey && clipboard !== null && selectedNodeId !== null) {
            event.preventDefault();
            onPaste(selectedNodeId);
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [
    isInputActive, isWarningActive, onDismissWarning,
    selectedNodeId, subtreeRootId, clipboard,
    onNavigate, onCycleType, onReorder, onStartRename,
    onCreateChild, onDelete, onToggleCollapsed, onCycleStatus,
    onDeselect, onExitSubtree, onExitToRoot, onCut, onCopy, onPaste,
    findNodeById,
  ]);
}
