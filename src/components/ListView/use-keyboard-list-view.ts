import { useEffect } from "react";
import type { StatusMode } from "@/utils/filter-tree";

/** Alt+letter → filter status preset, matched on physical key so it works under any layout (same
 * bindings as the Mindmap). */
const STATUS_MODE_BY_CODE: Record<string, StatusMode> = {
  KeyA: "all",
  KeyP: "plan",
  KeyS: "start",
  KeyD: "do",
};

interface Options {
  isInputActive: boolean;
  selectedTaskId: string | null;
  /** Whether the selected row is currently blocked (and not a Habit instance) — gates Enter. */
  isSelectedBlocked: boolean;
  onNavigate: (direction: 1 | -1) => void;
  onCycleStatus: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onStartRename: (id: string) => void;
  onDeselect: () => void;
  onToggleFilter: () => void;
  onSetStatusMode: (mode: StatusMode) => void;
}

/** List View's keyboard bindings, mirroring the Mindmap's own where they translate: Alt+F toggles the
 * filter menu, Alt+A/P/S/D jump to a status preset, Up/Down move the selection between rows, Enter
 * cycles the selected row's status, E opens its editor, R renames it inline, Escape deselects. */
export function useKeyboardListView(options: Options): void {
  const {
    isInputActive, selectedTaskId, isSelectedBlocked,
    onNavigate, onCycleStatus, onOpenEditor, onStartRename, onDeselect,
    onToggleFilter, onSetStatusMode,
  } = options;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isInputActive) return;

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

      switch (event.code) {
        case "ArrowDown":
          event.preventDefault();
          onNavigate(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          onNavigate(-1);
          break;
        case "Enter":
          if (selectedTaskId !== null && !isSelectedBlocked) {
            event.preventDefault();
            onCycleStatus(selectedTaskId);
          }
          break;
        case "KeyE":
          if (selectedTaskId !== null) {
            event.preventDefault();
            onOpenEditor(selectedTaskId);
          }
          break;
        case "KeyR":
          if (selectedTaskId !== null) {
            event.preventDefault();
            onStartRename(selectedTaskId);
          }
          break;
        case "Escape":
          if (selectedTaskId !== null) {
            event.preventDefault();
            onDeselect();
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    isInputActive, selectedTaskId, isSelectedBlocked,
    onNavigate, onCycleStatus, onOpenEditor, onStartRename, onDeselect,
    onToggleFilter, onSetStatusMode,
  ]);
}
