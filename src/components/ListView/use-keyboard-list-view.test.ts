import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardListView } from "./use-keyboard-list-view";
import { listKeyboardContext } from "@/test/keyboard-context";

/** Physical-key code for a produced character, mirroring what a browser sets on the event. */
function keyToCode(key: string): string {
  if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
  return key; // Arrow*, Enter, Escape — code === key
}

function fireKey(key: string, modifiers: { altKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; repeat?: boolean } = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, code: keyToCode(key), bubbles: true, cancelable: true, ...modifiers }));
}

let addSpy: ReturnType<typeof vi.spyOn>;
let removeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  addSpy = vi.spyOn(window, "addEventListener");
  removeSpy = vi.spyOn(window, "removeEventListener");
});

afterEach(() => {
  addSpy.mockRestore();
  removeSpy.mockRestore();
});

describe("useKeyboardListView", () => {
  it("registers and cleans up a capturing keydown listener", () => {
    const { unmount } = renderHook((opts) => useKeyboardListView(opts), { initialProps: listKeyboardContext() });
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function), { capture: true });
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function), { capture: true });
  });

  it("Alt+F toggles the filter menu", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("f", { altKey: true });
    expect(options.onToggleFilter).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a", "all"],
    ["p", "plan"],
    ["s", "start"],
    ["d", "do"],
    ["b", "backlog"],
  ] as const)("Alt+%s sets the %s status preset", (key, mode) => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey(key, { altKey: true });
    expect(options.onSetStatusMode).toHaveBeenCalledWith(mode);
  });

  it("plain B toggles the selected row's backlog", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("b");
    expect(options.onToggleBacklog).toHaveBeenCalledWith("task-1");
    expect(options.onSetStatusMode).not.toHaveBeenCalled();
  });

  it("plain B does nothing with no row selected", () => {
    const options = listKeyboardContext({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("b");
    expect(options.onToggleBacklog).not.toHaveBeenCalled();
  });

  it("plain A cycles the selected row's Agentic flag without tripping the All preset", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("a");
    expect(options.onToggleAgentic).toHaveBeenCalledWith("task-1");
    expect(options.onSetStatusMode).not.toHaveBeenCalled();
  });

  it("Alt+A still sets the All preset and leaves the Agentic flag alone", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("a", { altKey: true });
    expect(options.onSetStatusMode).toHaveBeenCalledWith("all");
    expect(options.onToggleAgentic).not.toHaveBeenCalled();
  });

  it("plain A does nothing with no row selected", () => {
    const options = listKeyboardContext({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("a");
    expect(options.onToggleAgentic).not.toHaveBeenCalled();
  });

  it("ArrowDown/ArrowUp navigate the selection", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("ArrowDown");
    expect(options.onNavigate).toHaveBeenCalledWith(1);
    fireKey("ArrowUp");
    expect(options.onNavigate).toHaveBeenCalledWith(-1);
  });

  it("Enter cycles the selected row's status when not blocked", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter");
    expect(options.onCycleStatus).toHaveBeenCalledWith("task-1");
  });

  it("Enter does nothing when the selected row is blocked", () => {
    const options = listKeyboardContext({ isSelectedBlocked: true });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter");
    expect(options.onCycleStatus).not.toHaveBeenCalled();
  });

  it("Enter does nothing when nothing is selected", () => {
    const options = listKeyboardContext({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter");
    expect(options.onCycleStatus).not.toHaveBeenCalled();
  });

  it("E opens the editor for the selected row", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("e");
    expect(options.onOpenEditor).toHaveBeenCalledWith("task-1");
  });

  it("R starts renaming the selected row", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("r");
    expect(options.onStartRename).toHaveBeenCalledWith("task-1");
  });

  it("Ctrl+O opens the node search", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("o", { ctrlKey: true });
    expect(options.onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+O opens the node search with nothing selected", () => {
    const options = listKeyboardContext({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("o", { ctrlKey: true });
    expect(options.onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+O touches neither the selection nor the status preset", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("o", { ctrlKey: true });
    expect(options.onDeselect).not.toHaveBeenCalled();
    expect(options.onNavigate).not.toHaveBeenCalled();
    expect(options.onSetStatusMode).not.toHaveBeenCalled();
  });

  it("plain O does not open the node search", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("o");
    expect(options.onOpenSearch).not.toHaveBeenCalled();
  });

  it("Shift+Escape goes up one subtree level while inside a subtree", () => {
    const options = listKeyboardContext({ subtreeRootId: "project-1" });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape", { shiftKey: true });
    expect(options.onExitSubtree).toHaveBeenCalledTimes(1);
    expect(options.onExitToRoot).not.toHaveBeenCalled();
    expect(options.onDeselect).not.toHaveBeenCalled();
  });

  it("Ctrl+Escape goes straight back to the root while inside a subtree", () => {
    const options = listKeyboardContext({ subtreeRootId: "project-1" });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape", { ctrlKey: true });
    expect(options.onExitToRoot).toHaveBeenCalledTimes(1);
    expect(options.onExitSubtree).not.toHaveBeenCalled();
    expect(options.onDeselect).not.toHaveBeenCalled();
  });

  it("the subtree-exit chords do nothing at the true root", () => {
    const options = listKeyboardContext({ subtreeRootId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape", { shiftKey: true });
    fireKey("Escape", { ctrlKey: true });
    expect(options.onExitSubtree).not.toHaveBeenCalled();
    expect(options.onExitToRoot).not.toHaveBeenCalled();
  });

  it("bare Escape still deselects rather than leaving the subtree", () => {
    const options = listKeyboardContext({ subtreeRootId: "project-1" });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape");
    expect(options.onDeselect).toHaveBeenCalledTimes(1);
    expect(options.onExitSubtree).not.toHaveBeenCalled();
    expect(options.onExitToRoot).not.toHaveBeenCalled();
  });

  it("Escape deselects when something is selected", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape");
    expect(options.onDeselect).toHaveBeenCalledTimes(1);
  });

  it("Escape does nothing when nothing is selected", () => {
    const options = listKeyboardContext({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape");
    expect(options.onDeselect).not.toHaveBeenCalled();
  });

  it("ignores every binding while an input is active", () => {
    const options = listKeyboardContext({ isInputActive: true });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("e");
    fireKey("r");
    fireKey("ArrowDown");
    fireKey("f", { altKey: true });
    fireKey("o", { ctrlKey: true });
    expect(options.onOpenEditor).not.toHaveBeenCalled();
    expect(options.onStartRename).not.toHaveBeenCalled();
    expect(options.onNavigate).not.toHaveBeenCalled();
    expect(options.onToggleFilter).not.toHaveBeenCalled();
    expect(options.onOpenSearch).not.toHaveBeenCalled();
  });

  it("E/R with no selection do nothing", () => {
    const options = listKeyboardContext({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("e");
    fireKey("r");
    expect(options.onOpenEditor).not.toHaveBeenCalled();
    expect(options.onStartRename).not.toHaveBeenCalled();
  });

  // Ctrl+Z in both views, dispatched from the shared registry so the cheat-sheet lists it too.
  describe("undo and redo", () => {
    it("Ctrl+Z reaches undo", () => {
      const options = listKeyboardContext();
      renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
      fireKey("z", { ctrlKey: true });
      expect(options.onUndo).toHaveBeenCalledTimes(1);
      expect(options.onRedo).not.toHaveBeenCalled();
    });

    it("Ctrl+Shift+Z reaches redo, and not undo", () => {
      const options = listKeyboardContext();
      renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
      fireKey("z", { ctrlKey: true, shiftKey: true });
      expect(options.onRedo).toHaveBeenCalledTimes(1);
      expect(options.onUndo).not.toHaveBeenCalled();
    });

    it("Ctrl+Y reaches redo as well", () => {
      const options = listKeyboardContext();
      renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
      fireKey("y", { ctrlKey: true });
      expect(options.onRedo).toHaveBeenCalledTimes(1);
    });

    it("ignores both while an input is active", () => {
      const options = listKeyboardContext({ isInputActive: true });
      renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
      fireKey("z", { ctrlKey: true });
      fireKey("z", { ctrlKey: true, shiftKey: true });
      expect(options.onUndo).not.toHaveBeenCalled();
      expect(options.onRedo).not.toHaveBeenCalled();
    });

    // Inside a field Ctrl+Z means the field undo the browser already gives, not the board's.
    it("leaves a keystroke from inside a text field alone", () => {
      const options = listKeyboardContext();
      renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true }),
      );
      document.body.removeChild(input);
      expect(options.onUndo).not.toHaveBeenCalled();
    });
  });
});

describe("useKeyboardListView — f shows the board alone", () => {
  it("with no row selected, f hides the chrome", () => {
    const opts = listKeyboardContext({ selectedTaskId: null, selectedCommitmentId: null, selectedRowId: null });
    renderHook(() => useKeyboardListView(opts));
    fireKey("f");
    expect(opts.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("with a row selected, f does nothing — the same rule the Mindmap uses", () => {
    const opts = listKeyboardContext({ selectedTaskId: "task-1" });
    renderHook(() => useKeyboardListView(opts));
    fireKey("f");
    expect(opts.onToggleFullscreen).not.toHaveBeenCalled();
  });

  it("Alt+F still reaches the filter, not the board-alone mode", () => {
    const opts = listKeyboardContext({ selectedTaskId: null, selectedCommitmentId: null, selectedRowId: null });
    renderHook(() => useKeyboardListView(opts));
    fireKey("f", { altKey: true });
    expect(opts.onToggleFilter).toHaveBeenCalledTimes(1);
    expect(opts.onToggleFullscreen).not.toHaveBeenCalled();
  });
});

describe("useKeyboardListView — creating rows", () => {
  it("Tab creates a child of the selected row", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Tab");
    expect(options.onCreateChild).toHaveBeenCalledWith("task-1");
    expect(options.onCreateSibling).not.toHaveBeenCalled();
  });

  it("Shift+Enter creates a sibling of the selected row", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter", { shiftKey: true });
    expect(options.onCreateSibling).toHaveBeenCalledWith("task-1");
    expect(options.onCreateChild).not.toHaveBeenCalled();
  });

  // Shift+Enter shares its key with the two bare-Enter bindings, and strict chord matching is what
  // keeps them apart: creating a sibling must never also advance the row it was created beside.
  it("Shift+Enter does not cycle the selected row's status", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter", { shiftKey: true });
    expect(options.onCycleStatus).not.toHaveBeenCalled();
  });

  it("bare Enter still cycles the status and creates nothing", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter");
    expect(options.onCycleStatus).toHaveBeenCalledWith("task-1");
    expect(options.onCreateSibling).not.toHaveBeenCalled();
  });

  it.each(["Tab", "Enter"] as const)("%s does nothing with nothing selected", (key) => {
    const options = listKeyboardContext({ selectedTaskId: null, selectedRowId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey(key, key === "Enter" ? { shiftKey: true } : {});
    expect(options.onCreateChild).not.toHaveBeenCalled();
    expect(options.onCreateSibling).not.toHaveBeenCalled();
  });

  // List View creates Tasks and nothing else, and both chords read their parent off the selection.
  it.each(["Tab", "Enter"] as const)("%s does nothing while a Commitment is selected", (key) => {
    const options = listKeyboardContext({ selectedTaskId: null, selectedCommitmentId: "commitment-1" });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey(key, key === "Enter" ? { shiftKey: true } : {});
    expect(options.onCreateChild).not.toHaveBeenCalled();
    expect(options.onCreateSibling).not.toHaveBeenCalled();
  });

  it.each(["Tab", "Enter"] as const)("leaves a held %s to one row, not one per repeat", (key) => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    const modifiers = key === "Enter" ? { shiftKey: true } : {};
    fireKey(key, modifiers);
    fireKey(key, { ...modifiers, repeat: true });
    fireKey(key, { ...modifiers, repeat: true });
    const created = key === "Tab" ? options.onCreateChild : options.onCreateSibling;
    expect(created).toHaveBeenCalledTimes(1);
  });
});

describe("useKeyboardListView — deleting a row", () => {
  it("Delete raises the confirmation for the selected Task", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Delete");
    expect(options.onDelete).toHaveBeenCalledWith("task-1");
  });

  // A Commitment is a real row too, and the Mindmap deletes one; the chord acts on whichever kind
  // the single selection happens to be.
  it("Delete acts on a selected Commitment as readily", () => {
    const options = listKeyboardContext({ selectedTaskId: null, selectedCommitmentId: "commitment-1" });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Delete");
    expect(options.onDelete).toHaveBeenCalledWith("commitment-1");
  });

  it("Delete does nothing with no row selected", () => {
    const options = listKeyboardContext({ selectedTaskId: null, selectedRowId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Delete");
    expect(options.onDelete).not.toHaveBeenCalled();
  });

  it("leaves a held Delete to one confirmation, not one per repeat", () => {
    const options = listKeyboardContext();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Delete");
    fireKey("Delete", { repeat: true });
    expect(options.onDelete).toHaveBeenCalledTimes(1);
  });
});
