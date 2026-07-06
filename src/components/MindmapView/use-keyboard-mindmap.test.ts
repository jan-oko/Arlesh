import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardMindmap } from "./use-keyboard-mindmap";
import type { MindmapNode } from "@/utils/tree-layout";

function makeTask(id: string): MindmapNode {
  return { id, kind: "task", title: "Task", position: 0, tagIds: [], children: [] };
}

function makeAspect(id: string): MindmapNode {
  return { id, kind: "aspect", title: "Aspect", position: 0, tagIds: [], children: [] };
}

function makeDomain(id: string): MindmapNode {
  return { id, kind: "domain", title: "Domain", position: 0, tagIds: [], children: [] };
}

function makeFlow(id: string): MindmapNode {
  return { id, kind: "flow", title: "Flow", position: 0, tagIds: [], children: [] };
}

/** Physical-key code for a produced character, mirroring what a browser sets on the event. */
function keyToCode(key: string): string {
  if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (key === "/") return "Slash";
  return key; // Arrow*, Enter, Tab, Delete, Escape, F2 — code === key
}

function fireKey(key: string, modifiers: { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, code: keyToCode(key), bubbles: true, cancelable: true, ...modifiers }));
}

function baseOptions(overrides: Partial<Parameters<typeof useKeyboardMindmap>[0]> = {}) {
  return {
    isInputActive: false,
    isWarningActive: false,
    onDismissWarning: vi.fn(),
    selectedNodeId: "task-1" as string | null,
    selectedNodeIds: new Set(["task-1"]) as ReadonlySet<string>,
    subtreeRootId: null as string | null,
    clipboard: null,
    onNavigate: vi.fn(),
    onCycleType: vi.fn(),
    onReorder: vi.fn(),
    onStartRename: vi.fn(),
    onCreateChild: vi.fn(),
    onCreateSibling: vi.fn(),
    onInsertParent: vi.fn(),
    onOpenEditor: vi.fn(),
    onStartFlow: vi.fn(),
    onDelete: vi.fn() as (ids: string[]) => void,
    onToggleCollapsed: vi.fn(),
    onCycleStatus: vi.fn(),
    onDeselect: vi.fn(),
    onExitSubtree: vi.fn(),
    onExitToRoot: vi.fn(),
    onCut: vi.fn() as (ids: string[]) => void,
    onCopy: vi.fn() as (ids: string[]) => void,
    onPaste: vi.fn(),
    onEnterSubtree: vi.fn(),
    onOpenSearch: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onToggleFilter: vi.fn(),
    onSetStatusMode: vi.fn() as (mode: "all" | "plan" | "start" | "do") => void,
    onFocusRoot: vi.fn(),
    onCenterOnNode: vi.fn(),
    onConvertToFlow: vi.fn(),
    onExtendSelection: vi.fn() as (key: "ArrowUp" | "ArrowDown") => void,
    findNodeById: (id: string): MindmapNode | undefined =>
      id === "task-1" ? makeTask("task-1") : undefined,
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("useKeyboardMindmap — start flow (s)", () => {
  it("starts the flow when 's' is pressed on a focused flow node", () => {
    const opts = baseOptions({ selectedNodeId: "flow-1", findNodeById: (id: string) => (id === "flow-1" ? makeFlow("flow-1") : undefined) });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("s");
    expect(opts.onStartFlow).toHaveBeenCalledWith("flow-1");
  });

  it("does nothing when 's' is pressed on a non-flow node", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("s");
    expect(opts.onStartFlow).not.toHaveBeenCalled();
  });

  it("ignores Ctrl+s (reserved) on a flow node", () => {
    const opts = baseOptions({ selectedNodeId: "flow-1", findNodeById: (id: string) => (id === "flow-1" ? makeFlow("flow-1") : undefined) });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("s", { ctrlKey: true });
    expect(opts.onStartFlow).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — blocked when input/warning active", () => {
  it("ignores all keys when isInputActive is true", () => {
    const opts = baseOptions({ isInputActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowLeft");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });

  it("Escape calls onDismissWarning when isWarningActive", () => {
    const opts = baseOptions({ isWarningActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Escape");
    expect(opts.onDismissWarning).toHaveBeenCalledTimes(1);
  });

  it("other keys are ignored when isWarningActive", () => {
    const opts = baseOptions({ isWarningActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowLeft");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — arrow navigation", () => {
  it("ArrowLeft calls onNavigate with 'ArrowLeft'", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowLeft");
    expect(opts.onNavigate).toHaveBeenCalledWith("ArrowLeft");
  });

  it("ArrowRight calls onNavigate with 'ArrowRight'", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowRight");
    expect(opts.onNavigate).toHaveBeenCalledWith("ArrowRight");
  });

  it("ArrowUp calls onNavigate when no modifier", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp");
    expect(opts.onNavigate).toHaveBeenCalledWith("ArrowUp");
  });

  it("ArrowDown calls onNavigate when no modifier", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowDown");
    expect(opts.onNavigate).toHaveBeenCalledWith("ArrowDown");
  });

  it("Ctrl+ArrowUp calls onCycleType with -1", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp", { ctrlKey: true });
    expect(opts.onCycleType).toHaveBeenCalledWith("task-1", -1);
  });

  it("Ctrl+ArrowDown calls onCycleType with 1", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowDown", { ctrlKey: true });
    expect(opts.onCycleType).toHaveBeenCalledWith("task-1", 1);
  });

  it("ignores Ctrl+ArrowDown key auto-repeat (no duplicate-sibling race) and does not fall back to navigate", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", ctrlKey: true, repeat: true, bubbles: true, cancelable: true }));
    expect(opts.onCycleType).not.toHaveBeenCalled();
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });

  it("Alt+ArrowUp calls onReorder with -1", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp", { altKey: true });
    expect(opts.onReorder).toHaveBeenCalledWith("task-1", -1);
  });

  it("Alt+ArrowDown calls onReorder with 1", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowDown", { altKey: true });
    expect(opts.onReorder).toHaveBeenCalledWith("task-1", 1);
  });
});

describe("useKeyboardMindmap — Tab (create child)", () => {
  it("Tab on a node with hyphen (not tag) calls onCreateChild", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Tab");
    expect(opts.onCreateChild).toHaveBeenCalledWith("task-1");
  });

  it("Tab does not call onCreateChild for a tag-kind node", () => {
    const tagNode: MindmapNode = { id: "domain-9", kind: "tag", title: "tag", position: 0, tagIds: [], children: [] };
    const opts = baseOptions({
      selectedNodeId: "domain-9",
      findNodeById: (id) => (id === "domain-9" ? tagNode : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Tab");
    expect(opts.onCreateChild).not.toHaveBeenCalled();
  });

  it("Tab does nothing when no node is selected", () => {
    const opts = baseOptions({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Tab");
    expect(opts.onCreateChild).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Escape variants", () => {
  it("Ctrl+Escape calls onExitToRoot when subtreeRootId is set", () => {
    const opts = baseOptions({ subtreeRootId: "domain-1" });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Escape", { ctrlKey: true });
    expect(opts.onExitToRoot).toHaveBeenCalledTimes(1);
  });

  it("Shift+Escape calls onExitSubtree when subtreeRootId is set", () => {
    const opts = baseOptions({ subtreeRootId: "domain-1" });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Escape", { shiftKey: true });
    expect(opts.onExitSubtree).toHaveBeenCalledTimes(1);
  });

  it("plain Escape calls onDeselect when a node is selected", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Escape");
    expect(opts.onDeselect).toHaveBeenCalledTimes(1);
  });
});

describe("useKeyboardMindmap — Ctrl+V (paste)", () => {
  it("Ctrl+V calls onPaste when clipboard is set", () => {
    const opts = baseOptions({ clipboard: { operation: "cut", nodeIds: ["task-1"] } });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("v", { ctrlKey: true });
    expect(opts.onPaste).toHaveBeenCalledWith("task-1");
  });

  it("Ctrl+V does nothing when clipboard is null", () => {
    const opts = baseOptions({ clipboard: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("v", { ctrlKey: true });
    expect(opts.onPaste).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Ctrl+= / Ctrl+- (zoom)", () => {
  it("Ctrl+= zooms in (physical Equal key)", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", code: "Equal", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(opts.onZoomIn).toHaveBeenCalled();
  });

  it("Ctrl+- zooms out (physical Minus key)", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-", code: "Minus", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(opts.onZoomOut).toHaveBeenCalled();
  });

  it("plain = (no ctrl) does not zoom", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("=");
    expect(opts.onZoomIn).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Ctrl+O (node search)", () => {
  it("opens the node search on Ctrl+O, even with no selection", () => {
    const opts = baseOptions({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ז", code: "KeyO", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(opts.onOpenSearch).toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Ctrl+/ (toggle collapsed)", () => {
  it("Ctrl+/ calls onToggleCollapsed with the selected node id", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("/", { ctrlKey: true });
    expect(opts.onToggleCollapsed).toHaveBeenCalledWith("task-1");
  });
});

describe("useKeyboardMindmap — layout-agnostic letter shortcuts", () => {
  it("opens the editor on the physical E key even under a non-Latin layout", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    // Hebrew layout: physical E produces "ק", but the code is still "KeyE".
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ק", code: "KeyE", bubbles: true, cancelable: true }));
    expect(opts.onOpenEditor).toHaveBeenCalledWith("task-1");
  });

  it("cuts on the physical X key regardless of the produced character", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ט", code: "KeyX", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(opts.onCut).toHaveBeenCalled();
  });
});

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

  it("toggles a goal's status on plain Enter (via onCycleStatus)", () => {
    const goal: MindmapNode = { id: "goal-1", kind: "goal", title: "g", status: "active", position: 0, tagIds: [], children: [] };
    const opts = baseOptions({ selectedNodeId: "goal-1", findNodeById: (id) => (id === "goal-1" ? goal : undefined) });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onCycleStatus).toHaveBeenCalledWith("goal-1");
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

describe("useKeyboardMindmap — e opens editor modal", () => {
  it("calls onOpenEditor with the selected node id for a task", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("e");
    expect(opts.onOpenEditor).toHaveBeenCalledWith("task-1");
  });

  it("does nothing when no node is selected", () => {
    const opts = baseOptions({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("e");
    expect(opts.onOpenEditor).not.toHaveBeenCalled();
  });

  it("does nothing when input is active", () => {
    const opts = baseOptions({ isInputActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("e");
    expect(opts.onOpenEditor).not.toHaveBeenCalled();
  });

  it("does nothing for an aspect node", () => {
    const opts = baseOptions({
      selectedNodeId: "domain-1",
      findNodeById: (id: string) => (id === "domain-1" ? makeAspect("domain-1") : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("e");
    expect(opts.onOpenEditor).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — r renames node title", () => {
  it("calls onStartRename with the selected node id for a task", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("r");
    expect(opts.onStartRename).toHaveBeenCalledWith("task-1");
  });

  it("does nothing when no node is selected", () => {
    const opts = baseOptions({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("r");
    expect(opts.onStartRename).not.toHaveBeenCalled();
  });

  it("does nothing when input is active", () => {
    const opts = baseOptions({ isInputActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("r");
    expect(opts.onStartRename).not.toHaveBeenCalled();
  });

  it("does nothing for an aspect node", () => {
    const opts = baseOptions({
      selectedNodeId: "domain-1",
      findNodeById: (id: string) => (id === "domain-1" ? makeAspect("domain-1") : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("r");
    expect(opts.onStartRename).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — multi-select Ctrl+X/C/Delete", () => {
  it("Ctrl+X passes all selectedNodeIds to onCut", () => {
    const selectedNodeIds = new Set(["task-1", "task-2"]);
    const opts = baseOptions({ selectedNodeIds });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("x", { ctrlKey: true });
    expect(opts.onCut).toHaveBeenCalledWith(expect.arrayContaining(["task-1", "task-2"]));
    expect((opts.onCut as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("Ctrl+C passes all selectedNodeIds to onCopy", () => {
    const selectedNodeIds = new Set(["task-1", "task-2"]);
    const opts = baseOptions({ selectedNodeIds });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("c", { ctrlKey: true });
    expect(opts.onCopy).toHaveBeenCalledWith(expect.arrayContaining(["task-1", "task-2"]));
    expect((opts.onCopy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("Delete passes all selectedNodeIds to onDelete", () => {
    const selectedNodeIds = new Set(["task-1", "task-2"]);
    const opts = baseOptions({ selectedNodeIds });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Delete");
    expect(opts.onDelete).toHaveBeenCalledWith(expect.arrayContaining(["task-1", "task-2"]));
    expect((opts.onDelete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("Ctrl+X with single selected node passes [selectedNodeId] to onCut", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("x", { ctrlKey: true });
    expect(opts.onCut).toHaveBeenCalledWith(["task-1"]);
  });
});

describe("useKeyboardMindmap — double-tap Enter enters subtree", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onEnterSubtree on second Enter within 300ms for a domain node", () => {
    vi.useFakeTimers();
    const opts = baseOptions({
      selectedNodeId: "domain-1",
      findNodeById: (id) => (id === "domain-1" ? makeDomain("domain-1") : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    vi.advanceTimersByTime(100);
    fireKey("Enter");
    expect(opts.onEnterSubtree).toHaveBeenCalledWith("domain-1");
  });

  it("does not call onEnterSubtree when two Enters are more than 300ms apart", () => {
    vi.useFakeTimers();
    const opts = baseOptions({
      selectedNodeId: "domain-1",
      findNodeById: (id) => (id === "domain-1" ? makeDomain("domain-1") : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    vi.advanceTimersByTime(400);
    fireKey("Enter");
    expect(opts.onEnterSubtree).not.toHaveBeenCalled();
  });

  it("does not call onEnterSubtree for a task node on double-tap", () => {
    vi.useFakeTimers();
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    vi.advanceTimersByTime(100);
    fireKey("Enter");
    expect(opts.onEnterSubtree).not.toHaveBeenCalled();
  });

  it("does not call onEnterSubtree when no node is selected", () => {
    vi.useFakeTimers();
    const opts = baseOptions({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    vi.advanceTimersByTime(100);
    fireKey("Enter");
    expect(opts.onEnterSubtree).not.toHaveBeenCalled();
  });

  it("does not call onEnterSubtree on the first Enter alone", () => {
    vi.useFakeTimers();
    const opts = baseOptions({
      selectedNodeId: "domain-1",
      findNodeById: (id) => (id === "domain-1" ? makeDomain("domain-1") : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onEnterSubtree).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — filter shortcuts (Alt)", () => {
  it("Alt+F toggles the filter menu", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("f", { altKey: true });
    expect(opts.onToggleFilter).toHaveBeenCalledTimes(1);
  });

  it("Alt+<first letter> selects each status mode", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("a", { altKey: true });
    fireKey("p", { altKey: true });
    fireKey("s", { altKey: true });
    fireKey("d", { altKey: true });
    expect(opts.onSetStatusMode).toHaveBeenNthCalledWith(1, "all");
    expect(opts.onSetStatusMode).toHaveBeenNthCalledWith(2, "plan");
    expect(opts.onSetStatusMode).toHaveBeenNthCalledWith(3, "start");
    expect(opts.onSetStatusMode).toHaveBeenNthCalledWith(4, "do");
  });

  it("Alt+S selects the Start mode without starting a flow", () => {
    const opts = baseOptions({ selectedNodeId: "flow-1", findNodeById: (id: string) => (id === "flow-1" ? makeFlow("flow-1") : undefined) });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("s", { altKey: true });
    expect(opts.onSetStatusMode).toHaveBeenCalledWith("start");
    expect(opts.onStartFlow).not.toHaveBeenCalled();
  });

  it("plain 's' still starts a flow (Alt gate does not swallow it)", () => {
    const opts = baseOptions({ selectedNodeId: "flow-1", findNodeById: (id: string) => (id === "flow-1" ? makeFlow("flow-1") : undefined) });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("s");
    expect(opts.onStartFlow).toHaveBeenCalledWith("flow-1");
    expect(opts.onSetStatusMode).not.toHaveBeenCalled();
  });

  it("Alt+ArrowUp still reorders (the Alt filter gate lets non-letter keys through)", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp", { altKey: true });
    expect(opts.onReorder).toHaveBeenCalledWith("task-1", -1);
  });
});

describe("useKeyboardMindmap — Enter focuses the root when nothing is selected", () => {
  it("focuses the display root on Enter with no selection", () => {
    const opts = baseOptions({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onFocusRoot).toHaveBeenCalledTimes(1);
  });

  it("does not focus the root when a node is already selected", () => {
    const opts = baseOptions({ selectedNodeId: "task-1" });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onFocusRoot).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — c centers the view on the selected node", () => {
  it("calls onCenterOnNode with the selected node id", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("c");
    expect(opts.onCenterOnNode).toHaveBeenCalledWith("task-1");
  });

  it("does nothing when no node is selected", () => {
    const opts = baseOptions({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("c");
    expect(opts.onCenterOnNode).not.toHaveBeenCalled();
  });

  it("Ctrl+C still copies and does not center", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("c", { ctrlKey: true });
    expect(opts.onCopy).toHaveBeenCalled();
    expect(opts.onCenterOnNode).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — f converts an applicable node to a flow", () => {
  it("calls onConvertToFlow with the selected node id", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("f");
    expect(opts.onConvertToFlow).toHaveBeenCalledWith("task-1");
  });

  it("does nothing when no node is selected", () => {
    const opts = baseOptions({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("f");
    expect(opts.onConvertToFlow).not.toHaveBeenCalled();
  });

  it("Alt+F still toggles the filter menu and does not convert", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("f", { altKey: true });
    expect(opts.onToggleFilter).toHaveBeenCalledTimes(1);
    expect(opts.onConvertToFlow).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Shift+Arrow extends the selection", () => {
  it("Shift+ArrowUp calls onExtendSelection with 'ArrowUp'", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp", { shiftKey: true });
    expect(opts.onExtendSelection).toHaveBeenCalledWith("ArrowUp");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });

  it("Shift+ArrowDown calls onExtendSelection with 'ArrowDown'", () => {
    const opts = baseOptions();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowDown", { shiftKey: true });
    expect(opts.onExtendSelection).toHaveBeenCalledWith("ArrowDown");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });
});
