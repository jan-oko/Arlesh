import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardListView } from "./use-keyboard-list-view";

/** Physical-key code for a produced character, mirroring what a browser sets on the event. */
function keyToCode(key: string): string {
  if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
  return key; // Arrow*, Enter, Escape — code === key
}

function fireKey(key: string, modifiers: { altKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, code: keyToCode(key), bubbles: true, cancelable: true, ...modifiers }));
}

function baseOptions(overrides: Partial<Parameters<typeof useKeyboardListView>[0]> = {}) {
  const merged = {
    isInputActive: false,
    selectedTaskId: "task-1" as string | null,
    selectedCommitmentId: null as string | null,
    isSelectedBlocked: false,
    onNavigate: vi.fn(),
    onScrollList: vi.fn(),
    onCycleStatus: vi.fn(),
    onOpenEditor: vi.fn(),
    onStartRename: vi.fn(),
    onDeselect: vi.fn(),
    onToggleFilter: vi.fn(),
    onSetStatusMode: vi.fn(),
    onOpenSearch: vi.fn(),
    subtreeRootId: null as string | null,
    onExitSubtree: vi.fn(),
    onExitToRoot: vi.fn(),
    onToggleBacklog: vi.fn(),
    onToggleAgentic: vi.fn(),
    onMarkKept: vi.fn(),
    onMarkBroken: vi.fn(),
    onToggleFullscreen: vi.fn(),
    ...overrides,
  };
  // `selectedRowId` is whichever of the two kinds is selected, exactly as ListView derives it —
  // computed here rather than defaulted, so a test that says "nothing is selected" is not
  // silently contradicted by a stale row id.
  return {
    ...merged,
    selectedRowId: overrides.selectedRowId ?? merged.selectedTaskId ?? merged.selectedCommitmentId,
  };
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
    const { unmount } = renderHook((opts) => useKeyboardListView(opts), { initialProps: baseOptions() });
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function), { capture: true });
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function), { capture: true });
  });

  it("Alt+F toggles the filter menu", () => {
    const options = baseOptions();
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
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey(key, { altKey: true });
    expect(options.onSetStatusMode).toHaveBeenCalledWith(mode);
  });

  it("plain B toggles the selected row's backlog", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("b");
    expect(options.onToggleBacklog).toHaveBeenCalledWith("task-1");
    expect(options.onSetStatusMode).not.toHaveBeenCalled();
  });

  it("plain B does nothing with no row selected", () => {
    const options = baseOptions({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("b");
    expect(options.onToggleBacklog).not.toHaveBeenCalled();
  });

  it("plain A cycles the selected row's Agentic flag without tripping the All preset", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("a");
    expect(options.onToggleAgentic).toHaveBeenCalledWith("task-1");
    expect(options.onSetStatusMode).not.toHaveBeenCalled();
  });

  it("Alt+A still sets the All preset and leaves the Agentic flag alone", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("a", { altKey: true });
    expect(options.onSetStatusMode).toHaveBeenCalledWith("all");
    expect(options.onToggleAgentic).not.toHaveBeenCalled();
  });

  it("plain A does nothing with no row selected", () => {
    const options = baseOptions({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("a");
    expect(options.onToggleAgentic).not.toHaveBeenCalled();
  });

  it("ArrowDown/ArrowUp navigate the selection", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("ArrowDown");
    expect(options.onNavigate).toHaveBeenCalledWith(1);
    fireKey("ArrowUp");
    expect(options.onNavigate).toHaveBeenCalledWith(-1);
  });

  it("Enter cycles the selected row's status when not blocked", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter");
    expect(options.onCycleStatus).toHaveBeenCalledWith("task-1");
  });

  it("Enter does nothing when the selected row is blocked", () => {
    const options = baseOptions({ isSelectedBlocked: true });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter");
    expect(options.onCycleStatus).not.toHaveBeenCalled();
  });

  it("Enter does nothing when nothing is selected", () => {
    const options = baseOptions({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Enter");
    expect(options.onCycleStatus).not.toHaveBeenCalled();
  });

  it("E opens the editor for the selected row", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("e");
    expect(options.onOpenEditor).toHaveBeenCalledWith("task-1");
  });

  it("R starts renaming the selected row", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("r");
    expect(options.onStartRename).toHaveBeenCalledWith("task-1");
  });

  it("Ctrl+O opens the node search", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("o", { ctrlKey: true });
    expect(options.onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+O opens the node search with nothing selected", () => {
    const options = baseOptions({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("o", { ctrlKey: true });
    expect(options.onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+O touches neither the selection nor the status preset", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("o", { ctrlKey: true });
    expect(options.onDeselect).not.toHaveBeenCalled();
    expect(options.onNavigate).not.toHaveBeenCalled();
    expect(options.onSetStatusMode).not.toHaveBeenCalled();
  });

  it("plain O does not open the node search", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("o");
    expect(options.onOpenSearch).not.toHaveBeenCalled();
  });

  it("Shift+Escape goes up one subtree level while inside a subtree", () => {
    const options = baseOptions({ subtreeRootId: "project-1" });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape", { shiftKey: true });
    expect(options.onExitSubtree).toHaveBeenCalledTimes(1);
    expect(options.onExitToRoot).not.toHaveBeenCalled();
    expect(options.onDeselect).not.toHaveBeenCalled();
  });

  it("Ctrl+Escape goes straight back to the root while inside a subtree", () => {
    const options = baseOptions({ subtreeRootId: "project-1" });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape", { ctrlKey: true });
    expect(options.onExitToRoot).toHaveBeenCalledTimes(1);
    expect(options.onExitSubtree).not.toHaveBeenCalled();
    expect(options.onDeselect).not.toHaveBeenCalled();
  });

  it("the subtree-exit chords do nothing at the true root", () => {
    const options = baseOptions({ subtreeRootId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape", { shiftKey: true });
    fireKey("Escape", { ctrlKey: true });
    expect(options.onExitSubtree).not.toHaveBeenCalled();
    expect(options.onExitToRoot).not.toHaveBeenCalled();
  });

  it("bare Escape still deselects rather than leaving the subtree", () => {
    const options = baseOptions({ subtreeRootId: "project-1" });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape");
    expect(options.onDeselect).toHaveBeenCalledTimes(1);
    expect(options.onExitSubtree).not.toHaveBeenCalled();
    expect(options.onExitToRoot).not.toHaveBeenCalled();
  });

  it("Escape deselects when something is selected", () => {
    const options = baseOptions();
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape");
    expect(options.onDeselect).toHaveBeenCalledTimes(1);
  });

  it("Escape does nothing when nothing is selected", () => {
    const options = baseOptions({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("Escape");
    expect(options.onDeselect).not.toHaveBeenCalled();
  });

  it("ignores every binding while an input is active", () => {
    const options = baseOptions({ isInputActive: true });
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
    const options = baseOptions({ selectedTaskId: null });
    renderHook((opts) => useKeyboardListView(opts), { initialProps: options });
    fireKey("e");
    fireKey("r");
    expect(options.onOpenEditor).not.toHaveBeenCalled();
    expect(options.onStartRename).not.toHaveBeenCalled();
  });
});

describe("useKeyboardListView — f shows the board alone", () => {
  it("with no row selected, f hides the chrome", () => {
    const opts = baseOptions({ selectedTaskId: null, selectedCommitmentId: null, selectedRowId: null });
    renderHook(() => useKeyboardListView(opts));
    fireKey("f");
    expect(opts.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("with a row selected, f does nothing — the same rule the Mindmap uses", () => {
    const opts = baseOptions({ selectedTaskId: "task-1" });
    renderHook(() => useKeyboardListView(opts));
    fireKey("f");
    expect(opts.onToggleFullscreen).not.toHaveBeenCalled();
  });

  it("Alt+F still reaches the filter, not the board-alone mode", () => {
    const opts = baseOptions({ selectedTaskId: null, selectedCommitmentId: null, selectedRowId: null });
    renderHook(() => useKeyboardListView(opts));
    fireKey("f", { altKey: true });
    expect(opts.onToggleFilter).toHaveBeenCalledTimes(1);
    expect(opts.onToggleFullscreen).not.toHaveBeenCalled();
  });
});
