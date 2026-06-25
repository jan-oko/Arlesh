import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardMindmap } from "./use-keyboard-mindmap";
import type { MindmapNode } from "@/utils/tree-layout";

function makeTask(id: string): MindmapNode {
  return { id, kind: "task", title: "Task", position: 0, tagIds: [], children: [] };
}

function makeAspect(id: string): MindmapNode {
  return { id, kind: "aspect", title: "Aspect", position: 0, tagIds: [], children: [] };
}

function fireKey(key: string, modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));
}

function baseOptions(overrides: Partial<Parameters<typeof useKeyboardMindmap>[0]> = {}) {
  return {
    isInputActive: false,
    isWarningActive: false,
    onDismissWarning: vi.fn(),
    selectedNodeId: "task-1" as string | null,
    subtreeRootId: null as string | null,
    clipboard: null,
    onNavigate: vi.fn(),
    onCycleType: vi.fn(),
    onReorder: vi.fn(),
    onStartRename: vi.fn(),
    onCreateChild: vi.fn(),
    onCreateSibling: vi.fn(),
    onInsertParent: vi.fn(),
    onDelete: vi.fn(),
    onToggleCollapsed: vi.fn(),
    onCycleStatus: vi.fn(),
    onDeselect: vi.fn(),
    onExitSubtree: vi.fn(),
    onExitToRoot: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    findNodeById: (id: string): MindmapNode | undefined =>
      id === "task-1" ? makeTask("task-1") : undefined,
    ...overrides,
  };
}

describe("useKeyboardMindmap — Shift+Enter creates sibling", () => {
  it("calls onCreateSibling with the selected node id", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { shiftKey: true });
    expect(opts.onCreateSibling).toHaveBeenCalledWith("task-1");
  });

  it("does nothing when no node is selected", () => {
    const opts = baseOptions({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { shiftKey: true });
    expect(opts.onCreateSibling).not.toHaveBeenCalled();
  });

  it("does nothing when input is active", () => {
    const opts = baseOptions({ isInputActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { shiftKey: true });
    expect(opts.onCreateSibling).not.toHaveBeenCalled();
  });

  it("does not also trigger onCycleStatus", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { shiftKey: true });
    expect(opts.onCycleStatus).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Ctrl+Enter inserts intermediate parent", () => {
  it("calls onInsertParent with the selected node id", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { ctrlKey: true });
    expect(opts.onInsertParent).toHaveBeenCalledWith("task-1");
  });

  it("does nothing when no node is selected", () => {
    const opts = baseOptions({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { ctrlKey: true });
    expect(opts.onInsertParent).not.toHaveBeenCalled();
  });

  it("does nothing when input is active", () => {
    const opts = baseOptions({ isInputActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { ctrlKey: true });
    expect(opts.onInsertParent).not.toHaveBeenCalled();
  });

  it("does not also trigger onCycleStatus", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { ctrlKey: true });
    expect(opts.onCycleStatus).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — plain Enter cycles task status", () => {
  it("calls onCycleStatus for an unblocked task", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onCycleStatus).toHaveBeenCalledWith("task-1");
  });

  it("does not call onCycleStatus when Shift+Enter is pressed", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { shiftKey: true });
    expect(opts.onCycleStatus).not.toHaveBeenCalled();
  });

  it("does not call onCycleStatus when Ctrl+Enter is pressed", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { ctrlKey: true });
    expect(opts.onCycleStatus).not.toHaveBeenCalled();
  });

  it("does not call onCreateSibling on plain Enter", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onCreateSibling).not.toHaveBeenCalled();
  });

  it("does not call onInsertParent on plain Enter", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onInsertParent).not.toHaveBeenCalled();
  });

  it("does not cycle status for an aspect node", () => {
    const opts = baseOptions({
      selectedNodeId: "domain-99",
      findNodeById: (id: string) => (id === "domain-99" ? makeAspect("domain-99") : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onCycleStatus).not.toHaveBeenCalled();
  });
});
