import { useEffect, useRef } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";

type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

interface ClipboardEntry {
  operation: "cut" | "copy";
  nodeIds: string[];
}

interface Options {
  isInputActive: boolean;
  isWarningActive: boolean;
  onDismissWarning: () => void;
  selectedNodeId: string | null;
  selectedNodeIds: ReadonlySet<string>;
  subtreeRootId: string | null;
  clipboard: ClipboardEntry | null;
  onNavigate: (key: ArrowKey) => void;
  onCycleType: (id: string, dir: 1 | -1) => void;
  onReorder: (id: string, dir: 1 | -1) => void;
  onStartRename: (id: string) => void;
  onCreateChild: (id: string) => void;
  onCreateSibling: (id: string) => void;
  onInsertParent: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onStartFlow: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onToggleCollapsed: (id: string) => void;
  onCycleStatus: (id: string) => void;
  onDeselect: () => void;
  onExitSubtree: () => void;
  onExitToRoot: () => void;
  onCut: (ids: string[]) => void;
  onCopy: (ids: string[]) => void;
  onPaste: (id: string) => void;
  onEnterSubtree: (id: string) => void;
  onOpenSearch: () => void;
  findNodeById: (id: string) => MindmapNode | undefined;
}

export function useKeyboardMindmap(options: Options): void {
  const {
    isInputActive, isWarningActive, onDismissWarning,
    selectedNodeId, selectedNodeIds, subtreeRootId, clipboard,
    onNavigate, onCycleType, onReorder, onStartRename,
    onCreateChild, onCreateSibling, onInsertParent, onOpenEditor, onStartFlow, onDelete, onToggleCollapsed, onCycleStatus,
    onDeselect, onExitSubtree, onExitToRoot, onCut, onCopy, onPaste, onEnterSubtree, onOpenSearch,
    findNodeById,
  } = options;

  const lastEnterMs = useRef(-Infinity);
  const DOUBLE_TAP_MS = 300;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isInputActive) return;

      if (isWarningActive) {
        if (event.code === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          onDismissWarning();
        }
        return;
      }

      // Match on `event.code` (physical key position), not `event.key` (the produced character), so
      // the letter shortcuts fire on the same physical keys under a non-Latin layout (e.g. Hebrew).
      // For non-character keys (arrows, Enter, Tab, Delete, Escape, F2) `code` equals `key`.
      switch (event.code) {
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
          // Type-cycling ignores key auto-repeat: each cross-table retype creates+deletes a node, and
          // held-key repeats race the reload, spawning duplicate siblings.
          if (event.ctrlKey) { if (!event.repeat && selectedNodeId !== null) onCycleType(selectedNodeId, -1); }
          else if (event.altKey && selectedNodeId !== null) onReorder(selectedNodeId, -1);
          else onNavigate("ArrowUp");
          break;
        case "ArrowDown":
          event.preventDefault();
          if (event.ctrlKey) { if (!event.repeat && selectedNodeId !== null) onCycleType(selectedNodeId, 1); }
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
            if (event.shiftKey) {
              event.preventDefault();
              onCreateSibling(selectedNodeId);
            } else if (event.ctrlKey) {
              event.preventDefault();
              onInsertParent(selectedNodeId);
            } else {
              const node = findNodeById(selectedNodeId);
              const now = Date.now();
              const isDoubleTap = now - lastEnterMs.current < DOUBLE_TAP_MS;
              const canEnter = node !== undefined &&
                node.kind !== "task" && node.kind !== "goal" && node.kind !== "tag";

              if (isDoubleTap && canEnter) {
                lastEnterMs.current = -Infinity;
                event.preventDefault();
                onEnterSubtree(selectedNodeId);
              } else {
                lastEnterMs.current = now;
                // Enter cycles a task's status and toggles a goal's achieved state (both via
                // onCycleStatus) — but not while the node is blocked.
                if (node !== undefined && (node.kind === "goal" || node.kind === "task") && !isNodeBlocked(node)) {
                  event.preventDefault();
                  onCycleStatus(selectedNodeId);
                }
              }
            }
          }
          break;
        }
        case "Delete":
          if (selectedNodeId !== null) {
            event.preventDefault();
            onDelete([...selectedNodeIds]);
          }
          break;
        case "Slash":
          if (event.ctrlKey && selectedNodeId !== null) {
            event.preventDefault();
            onToggleCollapsed(selectedNodeId);
          }
          break;
        case "KeyS":
          if (!event.ctrlKey && !event.metaKey && selectedNodeId !== null) {
            const node = findNodeById(selectedNodeId);
            if (node !== undefined && node.kind === "flow") {
              event.preventDefault();
              onStartFlow(selectedNodeId);
            }
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
        case "KeyX":
          if (event.ctrlKey && selectedNodeId !== null) {
            event.preventDefault();
            onCut([...selectedNodeIds]);
          }
          break;
        case "KeyC":
          if (event.ctrlKey && selectedNodeId !== null) {
            event.preventDefault();
            onCopy([...selectedNodeIds]);
          }
          break;
        case "KeyV":
          if (event.ctrlKey && clipboard !== null && selectedNodeId !== null) {
            event.preventDefault();
            onPaste(selectedNodeId);
          }
          break;
        case "KeyE":
          if (selectedNodeId !== null) {
            const node = findNodeById(selectedNodeId);
            if (node !== undefined && node.kind !== "aspect") {
              event.preventDefault();
              onOpenEditor(selectedNodeId);
            }
          }
          break;
        case "KeyO":
          if (event.ctrlKey) {
            event.preventDefault();
            onOpenSearch();
          }
          break;
        case "KeyR":
          if (selectedNodeId !== null) {
            const node = findNodeById(selectedNodeId);
            if (node !== undefined && node.kind !== "aspect") {
              event.preventDefault();
              onStartRename(selectedNodeId);
            }
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
    selectedNodeId, selectedNodeIds, subtreeRootId, clipboard,
    onNavigate, onCycleType, onReorder, onStartRename,
    onCreateChild, onCreateSibling, onInsertParent, onOpenEditor, onStartFlow, onDelete, onToggleCollapsed, onCycleStatus,
    onDeselect, onExitSubtree, onExitToRoot, onCut, onCopy, onPaste, onEnterSubtree, onOpenSearch,
    findNodeById,
  ]);
}
