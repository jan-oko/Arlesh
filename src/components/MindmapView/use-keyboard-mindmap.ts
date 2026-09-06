import { useEffect, useRef } from "react";
import type { MindmapNode, Orientation } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";
import type { StatusMode } from "@/utils/filter-tree";

/** Alt+letter → filter status preset, matched on physical key so it works under any layout. */
const STATUS_MODE_BY_CODE: Record<string, StatusMode> = {
  KeyA: "all",
  KeyP: "plan",
  KeyS: "start",
  KeyD: "do",
};

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
  onPanCanvas: (key: ArrowKey) => void;
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
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleFilter: () => void;
  onSetStatusMode: (mode: StatusMode) => void;
  onFocusRoot: () => void;
  onCenterOnNode: (id: string) => void;
  onConvertToFlow: (id: string) => void;
  onExtendSelection: (key: ArrowKey) => void;
  /** Which axis branches grow along — decides which Shift+arrows walk the sibling range. */
  orientation: Orientation;
  findNodeById: (id: string) => MindmapNode | undefined;
}

export function useKeyboardMindmap(options: Options): void {
  const {
    isInputActive, isWarningActive, onDismissWarning,
    selectedNodeId, selectedNodeIds, subtreeRootId, clipboard,
    onNavigate, onPanCanvas, onCycleType, onReorder, onStartRename,
    onCreateChild, onCreateSibling, onInsertParent, onOpenEditor, onStartFlow, onDelete, onToggleCollapsed, onCycleStatus,
    onDeselect, onExitSubtree, onExitToRoot, onCut, onCopy, onPaste, onEnterSubtree, onOpenSearch, onZoomIn, onZoomOut,
    onToggleFilter, onSetStatusMode, onFocusRoot, onCenterOnNode, onConvertToFlow, onExtendSelection,
    orientation, findNodeById,
  } = options;

  const lastEnterMs = useRef(-Infinity);
  const DOUBLE_TAP_MS = 300;

  useEffect(() => {
    // Siblings spread across the axis branches *don't* grow along, so that is the axis a
    // Shift+arrow walks a selection range over.
    const siblingAxisKeys: readonly ArrowKey[] =
      orientation === "vertical" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const extendsSelection = (key: ArrowKey): boolean => siblingAxisKeys.includes(key);

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

      // Alt (alone) shortcuts fire regardless of selection: open the Filter menu, or jump to a
      // status preset. Matched here before the main switch so Alt+S (Start mode) can't fall through
      // to the plain-S "start flow" binding. Non-letter Alt combos (e.g. Alt+Arrow reorder) match no
      // case and fall through to the main switch untouched.
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (event.code === "KeyF") {
          event.preventDefault();
          onToggleFilter();
          return;
        }
        const mode = Object.prototype.hasOwnProperty.call(STATUS_MODE_BY_CODE, event.code)
          ? STATUS_MODE_BY_CODE[event.code]
          : undefined;
        if (mode !== undefined) {
          event.preventDefault();
          onSetStatusMode(mode);
          return;
        }
      }

      // Match on `event.code` (physical key position), not `event.key` (the produced character), so
      // the letter shortcuts fire on the same physical keys under a non-Latin layout (e.g. Hebrew).
      // For non-character keys (arrows, Enter, Tab, Delete, Escape, F2) `code` equals `key`.
      switch (event.code) {
        case "ArrowLeft":
          event.preventDefault();
          if (event.shiftKey && extendsSelection("ArrowLeft")) onExtendSelection("ArrowLeft");
          else if (selectedNodeId !== null) onNavigate("ArrowLeft");
          else onPanCanvas("ArrowLeft");
          break;
        case "ArrowRight":
          event.preventDefault();
          if (event.shiftKey && extendsSelection("ArrowRight")) onExtendSelection("ArrowRight");
          else if (selectedNodeId !== null) onNavigate("ArrowRight");
          else onPanCanvas("ArrowRight");
          break;
        case "ArrowUp":
          event.preventDefault();
          // Type-cycling ignores key auto-repeat: each cross-table retype creates+deletes a node, and
          // held-key repeats race the reload, spawning duplicate siblings.
          if (event.ctrlKey) { if (!event.repeat && selectedNodeId !== null) onCycleType(selectedNodeId, -1); }
          else if (event.altKey && selectedNodeId !== null) onReorder(selectedNodeId, -1);
          else if (event.shiftKey && extendsSelection("ArrowUp")) onExtendSelection("ArrowUp");
          else if (selectedNodeId !== null) onNavigate("ArrowUp");
          else onPanCanvas("ArrowUp");
          break;
        case "ArrowDown":
          event.preventDefault();
          if (event.ctrlKey) { if (!event.repeat && selectedNodeId !== null) onCycleType(selectedNodeId, 1); }
          else if (event.altKey && selectedNodeId !== null) onReorder(selectedNodeId, 1);
          else if (event.shiftKey && extendsSelection("ArrowDown")) onExtendSelection("ArrowDown");
          else if (selectedNodeId !== null) onNavigate("ArrowDown");
          else onPanCanvas("ArrowDown");
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
          if (selectedNodeId === null) {
            // Nothing selected: a plain Enter focuses the current display root.
            if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault();
              onFocusRoot();
            }
            break;
          }
          {
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
        case "Equal":
        case "NumpadAdd":
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault(); // also suppresses the browser's page-zoom
            onZoomIn();
          }
          break;
        case "Minus":
        case "NumpadSubtract":
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            onZoomOut();
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
          } else if (!event.ctrlKey && !event.metaKey && !event.altKey && selectedNodeId !== null) {
            event.preventDefault();
            onCenterOnNode(selectedNodeId);
          }
          break;
        case "KeyF":
          if (!event.ctrlKey && !event.metaKey && !event.altKey && selectedNodeId !== null) {
            event.preventDefault();
            onConvertToFlow(selectedNodeId);
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
    onNavigate, onPanCanvas, onCycleType, onReorder, onStartRename,
    onCreateChild, onCreateSibling, onInsertParent, onOpenEditor, onStartFlow, onDelete, onToggleCollapsed, onCycleStatus,
    onDeselect, onExitSubtree, onExitToRoot, onCut, onCopy, onPaste, onEnterSubtree, onOpenSearch, onZoomIn, onZoomOut,
    onToggleFilter, onSetStatusMode, onFocusRoot, onCenterOnNode, onConvertToFlow, onExtendSelection,
    orientation, findNodeById,
  ]);
}
