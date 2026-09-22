import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardMindmap } from "./use-keyboard-mindmap";
import { mindmapKeyboardContext } from "@/test/keyboard-context";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TypedChildKind } from "@/utils/node-meta";
import { NO_CYCLE } from "@/api/flows";

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

function makeCommitment(id: string): MindmapNode {
  return { id, kind: "commitment", title: "Asleep by 23:00", verdict: "unresolved", position: 0, tagIds: [], children: [] };
}

/** The canvas with one commitment selected, since every verdict binding acts on the selection. */
function commitmentSelected(id = "commitment-1") {
  return mindmapKeyboardContext({
    selectedNodeId: id,
    selectedNodeIds: new Set([id]) as ReadonlySet<string>,
    findNodeById: (nodeId: string) => (nodeId === id ? makeCommitment(id) : undefined),
  });
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

beforeEach(() => { vi.clearAllMocks(); });

describe("useKeyboardMindmap — start flow (s)", () => {
  it("starts the flow when 's' is pressed on a focused flow node", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: "flow-1", findNodeById: (id: string) => (id === "flow-1" ? makeFlow("flow-1") : undefined) });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("s");
    expect(opts.onStartFlow).toHaveBeenCalledWith("flow-1");
  });

  it("does nothing when 's' is pressed on a non-flow node", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("s");
    expect(opts.onStartFlow).not.toHaveBeenCalled();
  });

  it("ignores Ctrl+s (reserved) on a flow node", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: "flow-1", findNodeById: (id: string) => (id === "flow-1" ? makeFlow("flow-1") : undefined) });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("s", { ctrlKey: true });
    expect(opts.onStartFlow).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — blocked when input/warning active", () => {
  it("ignores all keys when isInputActive is true", () => {
    const opts = mindmapKeyboardContext({ isInputActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowLeft");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });

  it("Escape calls onDismissWarning when isWarningActive", () => {
    const opts = mindmapKeyboardContext({ isWarningActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Escape");
    expect(opts.onDismissWarning).toHaveBeenCalledTimes(1);
  });

  it("other keys are ignored when isWarningActive", () => {
    const opts = mindmapKeyboardContext({ isWarningActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowLeft");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — arrow navigation", () => {
  it("ArrowLeft calls onNavigate with 'ArrowLeft'", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowLeft");
    expect(opts.onNavigate).toHaveBeenCalledWith("ArrowLeft");
  });

  it("ArrowRight calls onNavigate with 'ArrowRight'", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowRight");
    expect(opts.onNavigate).toHaveBeenCalledWith("ArrowRight");
  });

  it("ArrowUp calls onNavigate when no modifier", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp");
    expect(opts.onNavigate).toHaveBeenCalledWith("ArrowUp");
  });

  it("ArrowDown calls onNavigate when no modifier", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowDown");
    expect(opts.onNavigate).toHaveBeenCalledWith("ArrowDown");
  });

  it("Ctrl+ArrowUp calls onCycleType with -1", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp", { ctrlKey: true });
    expect(opts.onCycleType).toHaveBeenCalledWith("task-1", -1);
  });

  it("Ctrl+ArrowDown calls onCycleType with 1", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowDown", { ctrlKey: true });
    expect(opts.onCycleType).toHaveBeenCalledWith("task-1", 1);
  });

  it("ignores Ctrl+ArrowDown key auto-repeat (no duplicate-sibling race) and does not fall back to navigate", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", ctrlKey: true, repeat: true, bubbles: true, cancelable: true }));
    expect(opts.onCycleType).not.toHaveBeenCalled();
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });

  it("Alt+ArrowUp calls onReorder with -1", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp", { altKey: true });
    expect(opts.onReorder).toHaveBeenCalledWith("task-1", -1);
  });

  it("Alt+ArrowDown calls onReorder with 1", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowDown", { altKey: true });
    expect(opts.onReorder).toHaveBeenCalledWith("task-1", 1);
  });
});

describe("useKeyboardMindmap — arrow keys pan the canvas when nothing is selected", () => {
  it("ArrowLeft calls onPanCanvas instead of onNavigate", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowLeft");
    expect(opts.onPanCanvas).toHaveBeenCalledWith("ArrowLeft");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });

  it("ArrowRight calls onPanCanvas instead of onNavigate", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowRight");
    expect(opts.onPanCanvas).toHaveBeenCalledWith("ArrowRight");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });

  it("ArrowUp calls onPanCanvas instead of onNavigate", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp");
    expect(opts.onPanCanvas).toHaveBeenCalledWith("ArrowUp");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });

  it("ArrowDown calls onPanCanvas instead of onNavigate", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowDown");
    expect(opts.onPanCanvas).toHaveBeenCalledWith("ArrowDown");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });

  it("does not pan when a node is selected", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowLeft");
    fireKey("ArrowRight");
    fireKey("ArrowUp");
    fireKey("ArrowDown");
    expect(opts.onPanCanvas).not.toHaveBeenCalled();
  });

  it("Shift+ArrowUp still extends selection rather than panning, even with nothing selected", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp", { shiftKey: true });
    expect(opts.onExtendSelection).toHaveBeenCalledWith("ArrowUp");
    expect(opts.onPanCanvas).not.toHaveBeenCalled();
  });

  it("ignores all keys when isInputActive is true, including panning", () => {
    const opts = mindmapKeyboardContext({ isInputActive: true, selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowLeft");
    expect(opts.onPanCanvas).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Tab (create child)", () => {
  it("Tab on a node with hyphen (not tag) calls onCreateChild", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Tab");
    expect(opts.onCreateChild).toHaveBeenCalledWith("task-1");
  });

  it("Tab does not call onCreateChild for a tag-kind node", () => {
    const tagNode: MindmapNode = { id: "domain-9", kind: "tag", title: "tag", position: 0, tagIds: [], children: [] };
    const opts = mindmapKeyboardContext({
      selectedNodeId: "domain-9",
      findNodeById: (id) => (id === "domain-9" ? tagNode : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Tab");
    expect(opts.onCreateChild).not.toHaveBeenCalled();
  });

  it("Tab does nothing when no node is selected", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Tab");
    expect(opts.onCreateChild).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Escape variants", () => {
  it("Ctrl+Escape calls onExitToRoot when subtreeRootId is set", () => {
    const opts = mindmapKeyboardContext({ subtreeRootId: "domain-1" });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Escape", { ctrlKey: true });
    expect(opts.onExitToRoot).toHaveBeenCalledTimes(1);
  });

  it("Shift+Escape calls onExitSubtree when subtreeRootId is set", () => {
    const opts = mindmapKeyboardContext({ subtreeRootId: "domain-1" });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Escape", { shiftKey: true });
    expect(opts.onExitSubtree).toHaveBeenCalledTimes(1);
  });

  it("plain Escape calls onDeselect when a node is selected", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Escape");
    expect(opts.onDeselect).toHaveBeenCalledTimes(1);
  });
});

describe("useKeyboardMindmap — Ctrl+V (paste)", () => {
  it("Ctrl+V calls onPaste when clipboard is set", () => {
    const opts = mindmapKeyboardContext({ clipboard: { operation: "cut", nodeIds: ["task-1"] } });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("v", { ctrlKey: true });
    expect(opts.onPaste).toHaveBeenCalledWith("task-1");
  });

  it("Ctrl+V does nothing when clipboard is null", () => {
    const opts = mindmapKeyboardContext({ clipboard: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("v", { ctrlKey: true });
    expect(opts.onPaste).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Ctrl+= / Ctrl+- (zoom)", () => {
  it("Ctrl+= zooms in (physical Equal key)", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", code: "Equal", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(opts.onZoomIn).toHaveBeenCalled();
  });

  it("Ctrl+- zooms out (physical Minus key)", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-", code: "Minus", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(opts.onZoomOut).toHaveBeenCalled();
  });

  it("plain = (no ctrl) does not zoom", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("=");
    expect(opts.onZoomIn).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Ctrl+O (node search)", () => {
  it("opens the node search on Ctrl+O, even with no selection", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ז", code: "KeyO", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(opts.onOpenSearch).toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Ctrl+/ and Ctrl+Alt+/ (toggle collapsed)", () => {
  it("Ctrl+/ calls onToggleCollapsed with the selected node id", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("/", { ctrlKey: true });
    expect(opts.onToggleCollapsed).toHaveBeenCalledWith("task-1");
  });

  it("Ctrl+Alt+/ toggles the selected node's whole subtree instead of the node alone", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("/", { ctrlKey: true, altKey: true });
    expect(opts.onToggleSubtreeCollapsed).toHaveBeenCalledWith("task-1");
    expect(opts.onToggleCollapsed).not.toHaveBeenCalled();
  });

  // Ctrl+Shift+/ is the cheat-sheet's, and the Mindmap does not touch it: the recursive expand sits
  // on Ctrl+Alt+/ precisely so that neither binding has to guard against the other.
  it("Ctrl+Shift+/ collapses nothing — it belongs to the cheat-sheet", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("/", { ctrlKey: true, shiftKey: true });
    expect(opts.onToggleSubtreeCollapsed).not.toHaveBeenCalled();
    expect(opts.onToggleCollapsed).not.toHaveBeenCalled();
  });

  it("neither fires with nothing selected", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null, selectedNodeIds: new Set() });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("/", { ctrlKey: true });
    fireKey("/", { ctrlKey: true, altKey: true });
    expect(opts.onToggleCollapsed).not.toHaveBeenCalled();
    expect(opts.onToggleSubtreeCollapsed).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — layout-agnostic letter shortcuts", () => {
  it("opens the editor on the physical E key even under a non-Latin layout", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    // Hebrew layout: physical E produces "ק", but the code is still "KeyE".
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ק", code: "KeyE", bubbles: true, cancelable: true }));
    expect(opts.onOpenEditor).toHaveBeenCalledWith("task-1");
  });

  it("cuts on the physical X key regardless of the produced character", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ט", code: "KeyX", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(opts.onCut).toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Shift+Enter creates sibling", () => {
  it("calls onCreateSibling with the selected node id", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { shiftKey: true });
    expect(opts.onCreateSibling).toHaveBeenCalledWith("task-1");
  });

  it("does nothing when no node is selected", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { shiftKey: true });
    expect(opts.onCreateSibling).not.toHaveBeenCalled();
  });

  it("does nothing when input is active", () => {
    const opts = mindmapKeyboardContext({ isInputActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { shiftKey: true });
    expect(opts.onCreateSibling).not.toHaveBeenCalled();
  });

  it("does not also trigger onCycleStatus", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { shiftKey: true });
    expect(opts.onCycleStatus).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Ctrl+Enter inserts intermediate parent", () => {
  it("calls onInsertParent with the selected node id", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { ctrlKey: true });
    expect(opts.onInsertParent).toHaveBeenCalledWith("task-1");
  });

  it("does nothing when no node is selected", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { ctrlKey: true });
    expect(opts.onInsertParent).not.toHaveBeenCalled();
  });

  it("does nothing when input is active", () => {
    const opts = mindmapKeyboardContext({ isInputActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { ctrlKey: true });
    expect(opts.onInsertParent).not.toHaveBeenCalled();
  });

  it("does not also trigger onCycleStatus", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { ctrlKey: true });
    expect(opts.onCycleStatus).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — plain Enter cycles task status", () => {
  it("calls onCycleStatus for an unblocked task", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onCycleStatus).toHaveBeenCalledWith("task-1");
  });

  it("toggles a goal's status on plain Enter (via onCycleStatus)", () => {
    const goal: MindmapNode = { id: "goal-1", kind: "goal", title: "g", status: "active", position: 0, tagIds: [], children: [] };
    const opts = mindmapKeyboardContext({ selectedNodeId: "goal-1", findNodeById: (id) => (id === "goal-1" ? goal : undefined) });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onCycleStatus).toHaveBeenCalledWith("goal-1");
  });

  it("does not call onCycleStatus when Shift+Enter is pressed", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { shiftKey: true });
    expect(opts.onCycleStatus).not.toHaveBeenCalled();
  });

  it("does not call onCycleStatus when Ctrl+Enter is pressed", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter", { ctrlKey: true });
    expect(opts.onCycleStatus).not.toHaveBeenCalled();
  });

  it("does not call onCreateSibling on plain Enter", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onCreateSibling).not.toHaveBeenCalled();
  });

  it("does not call onInsertParent on plain Enter", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onInsertParent).not.toHaveBeenCalled();
  });

  it("does not cycle status for an aspect node", () => {
    const opts = mindmapKeyboardContext({
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
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("e");
    expect(opts.onOpenEditor).toHaveBeenCalledWith("task-1");
  });

  it("does nothing when no node is selected", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("e");
    expect(opts.onOpenEditor).not.toHaveBeenCalled();
  });

  it("does nothing when input is active", () => {
    const opts = mindmapKeyboardContext({ isInputActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("e");
    expect(opts.onOpenEditor).not.toHaveBeenCalled();
  });

  it("does nothing for an aspect node", () => {
    const opts = mindmapKeyboardContext({
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
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("r");
    expect(opts.onStartRename).toHaveBeenCalledWith("task-1");
  });

  it("does nothing when no node is selected", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("r");
    expect(opts.onStartRename).not.toHaveBeenCalled();
  });

  it("does nothing when input is active", () => {
    const opts = mindmapKeyboardContext({ isInputActive: true });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("r");
    expect(opts.onStartRename).not.toHaveBeenCalled();
  });

  it("does nothing for an aspect node", () => {
    const opts = mindmapKeyboardContext({
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
    const opts = mindmapKeyboardContext({ selectedNodeIds });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("x", { ctrlKey: true });
    expect(opts.onCut).toHaveBeenCalledWith(expect.arrayContaining(["task-1", "task-2"]));
    expect((opts.onCut as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("Ctrl+C passes all selectedNodeIds to onCopy", () => {
    const selectedNodeIds = new Set(["task-1", "task-2"]);
    const opts = mindmapKeyboardContext({ selectedNodeIds });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("c", { ctrlKey: true });
    expect(opts.onCopy).toHaveBeenCalledWith(expect.arrayContaining(["task-1", "task-2"]));
    expect((opts.onCopy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("Delete passes all selectedNodeIds to onDelete", () => {
    const selectedNodeIds = new Set(["task-1", "task-2"]);
    const opts = mindmapKeyboardContext({ selectedNodeIds });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Delete");
    expect(opts.onDelete).toHaveBeenCalledWith(expect.arrayContaining(["task-1", "task-2"]));
    expect((opts.onDelete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("Ctrl+X with single selected node passes [selectedNodeId] to onCut", () => {
    const opts = mindmapKeyboardContext();
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
    const opts = mindmapKeyboardContext({
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
    const opts = mindmapKeyboardContext({
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
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    vi.advanceTimersByTime(100);
    fireKey("Enter");
    expect(opts.onEnterSubtree).not.toHaveBeenCalled();
  });

  it("does not call onEnterSubtree when no node is selected", () => {
    vi.useFakeTimers();
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    vi.advanceTimersByTime(100);
    fireKey("Enter");
    expect(opts.onEnterSubtree).not.toHaveBeenCalled();
  });

  it("does not call onEnterSubtree on the first Enter alone", () => {
    vi.useFakeTimers();
    const opts = mindmapKeyboardContext({
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
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("f", { altKey: true });
    expect(opts.onToggleFilter).toHaveBeenCalledTimes(1);
  });

  it("Alt+<first letter> selects each status mode", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("a", { altKey: true });
    fireKey("p", { altKey: true });
    fireKey("s", { altKey: true });
    fireKey("d", { altKey: true });
    fireKey("b", { altKey: true });
    expect(opts.onSetStatusMode).toHaveBeenNthCalledWith(1, "all");
    expect(opts.onSetStatusMode).toHaveBeenNthCalledWith(2, "plan");
    expect(opts.onSetStatusMode).toHaveBeenNthCalledWith(3, "start");
    expect(opts.onSetStatusMode).toHaveBeenNthCalledWith(4, "do");
    expect(opts.onSetStatusMode).toHaveBeenNthCalledWith(5, "backlog");
  });

  it("plain B toggles the anchor task's backlog, leaving the rest of the selection alone", () => {
    const opts = mindmapKeyboardContext({
      selectedNodeId: "task-1",
      selectedNodeIds: new Set(["task-1", "task-2"]),
      findNodeById: (id: string) => (id === "task-1" ? makeTask("task-1") : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("b");
    expect(opts.onToggleBacklog).toHaveBeenCalledTimes(1);
    expect(opts.onToggleBacklog).toHaveBeenCalledWith("task-1");
    expect(opts.onSetStatusMode).not.toHaveBeenCalled();
  });

  it("plain B does nothing on a goal — Backlog is a Task-only state", () => {
    const goal: MindmapNode = { id: "goal-1", kind: "goal", title: "Goal", position: 0, tagIds: [], children: [] };
    const opts = mindmapKeyboardContext({
      selectedNodeId: "goal-1",
      findNodeById: (id: string) => (id === "goal-1" ? goal : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("b");
    expect(opts.onToggleBacklog).not.toHaveBeenCalled();
  });

  it("plain A cycles the anchor task's Agentic flag, leaving the rest of the selection alone", () => {
    const opts = mindmapKeyboardContext({
      selectedNodeId: "task-1",
      selectedNodeIds: new Set(["task-1", "task-2"]),
      findNodeById: (id: string) => (id === "task-1" ? makeTask("task-1") : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("a");
    expect(opts.onToggleAgentic).toHaveBeenCalledTimes(1);
    expect(opts.onToggleAgentic).toHaveBeenCalledWith("task-1");
    expect(opts.onSetStatusMode).not.toHaveBeenCalled();
  });

  it("Alt+A still selects the All mode without touching the Agentic flag", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("a", { altKey: true });
    expect(opts.onSetStatusMode).toHaveBeenCalledWith("all");
    expect(opts.onToggleAgentic).not.toHaveBeenCalled();
  });

  it("plain A does nothing on a goal — only a Task can be agentic", () => {
    const goal: MindmapNode = { id: "goal-1", kind: "goal", title: "Goal", position: 0, tagIds: [], children: [] };
    const opts = mindmapKeyboardContext({
      selectedNodeId: "goal-1",
      findNodeById: (id: string) => (id === "goal-1" ? goal : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("a");
    expect(opts.onToggleAgentic).not.toHaveBeenCalled();
  });

  it("plain A does nothing on a virtual Habit instance — it has no task row to flag", () => {
    const instance: MindmapNode = {
      id: "task-4-virtual", kind: "task", title: "Instance", position: 0, tagIds: [], children: [],
      virtual: true, habitItem: { flowId: 3, itemType: "flow_task", itemId: 4, scopeId: 100, cycleId: NO_CYCLE },
    };
    const opts = mindmapKeyboardContext({
      selectedNodeId: "task-4-virtual",
      selectedNodeIds: new Set(["task-4-virtual"]),
      findNodeById: (id: string) => (id === "task-4-virtual" ? instance : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("a");
    expect(opts.onToggleAgentic).not.toHaveBeenCalled();
  });

  it("plain W flips the anchor task's Asynchronous flag, leaving the rest of the selection alone", () => {
    const opts = mindmapKeyboardContext({
      selectedNodeId: "task-1",
      selectedNodeIds: new Set(["task-1", "task-2"]),
      findNodeById: (id: string) => (id === "task-1" ? makeTask("task-1") : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("w");
    expect(opts.onToggleAsynchronous).toHaveBeenCalledTimes(1);
    expect(opts.onToggleAsynchronous).toHaveBeenCalledWith("task-1");
    expect(opts.onToggleAgentic).not.toHaveBeenCalled();
  });

  it("plain W does nothing on a goal — only a Task starts a wait by being done", () => {
    const goal: MindmapNode = { id: "goal-1", kind: "goal", title: "Goal", position: 0, tagIds: [], children: [] };
    const opts = mindmapKeyboardContext({
      selectedNodeId: "goal-1",
      findNodeById: (id: string) => (id === "goal-1" ? goal : undefined),
    });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("w");
    expect(opts.onToggleAsynchronous).not.toHaveBeenCalled();
  });

  it("Alt+S selects the Start mode without starting a flow", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: "flow-1", findNodeById: (id: string) => (id === "flow-1" ? makeFlow("flow-1") : undefined) });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("s", { altKey: true });
    expect(opts.onSetStatusMode).toHaveBeenCalledWith("start");
    expect(opts.onStartFlow).not.toHaveBeenCalled();
  });

  it("plain 's' still starts a flow (Alt gate does not swallow it)", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: "flow-1", findNodeById: (id: string) => (id === "flow-1" ? makeFlow("flow-1") : undefined) });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("s");
    expect(opts.onStartFlow).toHaveBeenCalledWith("flow-1");
    expect(opts.onSetStatusMode).not.toHaveBeenCalled();
  });

  it("Alt+ArrowUp still reorders (the Alt filter gate lets non-letter keys through)", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp", { altKey: true });
    expect(opts.onReorder).toHaveBeenCalledWith("task-1", -1);
  });
});

describe("useKeyboardMindmap — Enter focuses the root when nothing is selected", () => {
  it("focuses the display root on Enter with no selection", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onFocusRoot).toHaveBeenCalledTimes(1);
  });

  it("does not focus the root when a node is already selected", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: "task-1" });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Enter");
    expect(opts.onFocusRoot).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — c centers the view on the selected node", () => {
  it("calls onCenterOnNode with the selected node id", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("c");
    expect(opts.onCenterOnNode).toHaveBeenCalledWith("task-1");
  });

  it("does nothing when no node is selected", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("c");
    expect(opts.onCenterOnNode).not.toHaveBeenCalled();
  });

  it("Ctrl+C still copies and does not center", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("c", { ctrlKey: true });
    expect(opts.onCopy).toHaveBeenCalled();
    expect(opts.onCenterOnNode).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — f converts an applicable node to a flow", () => {
  it("calls onConvertToFlow with the selected node id", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("f");
    expect(opts.onConvertToFlow).toHaveBeenCalledWith("task-1");
  });

  it("shows the board alone when no node is selected, since there is nothing to convert", () => {
    const opts = mindmapKeyboardContext({ selectedNodeId: null });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("f");
    expect(opts.onConvertToFlow).not.toHaveBeenCalled();
    expect(opts.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("does not show the board alone when a node IS selected — the conversion wins the key", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("f");
    expect(opts.onToggleFullscreen).not.toHaveBeenCalled();
  });

  it("Alt+F still toggles the filter menu and does not convert", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("f", { altKey: true });
    expect(opts.onToggleFilter).toHaveBeenCalledTimes(1);
    expect(opts.onConvertToFlow).not.toHaveBeenCalled();
    expect(opts.onToggleFullscreen).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Shift+Arrow extends the selection", () => {
  it("Shift+ArrowUp calls onExtendSelection with 'ArrowUp'", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowUp", { shiftKey: true });
    expect(opts.onExtendSelection).toHaveBeenCalledWith("ArrowUp");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });

  it("Shift+ArrowDown calls onExtendSelection with 'ArrowDown'", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowDown", { shiftKey: true });
    expect(opts.onExtendSelection).toHaveBeenCalledWith("ArrowDown");
    expect(opts.onNavigate).not.toHaveBeenCalled();
  });
});

describe("shift+arrow selection axis follows the orientation", () => {
  it("horizontal: Shift+Down extends the selection", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowDown", { shiftKey: true });
    expect(opts.onExtendSelection).toHaveBeenCalledWith("ArrowDown");
  });

  it("horizontal: Shift+Right navigates instead of extending", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowRight", { shiftKey: true });
    expect(opts.onExtendSelection).not.toHaveBeenCalled();
    expect(opts.onNavigate).toHaveBeenCalledWith("ArrowRight");
  });

  it("vertical: Shift+Right extends the selection", () => {
    const opts = mindmapKeyboardContext({ orientation: "vertical" as const });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowRight", { shiftKey: true });
    expect(opts.onExtendSelection).toHaveBeenCalledWith("ArrowRight");
  });

  it("vertical: Shift+Down navigates instead of extending", () => {
    const opts = mindmapKeyboardContext({ orientation: "vertical" as const });
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("ArrowDown", { shiftKey: true });
    expect(opts.onExtendSelection).not.toHaveBeenCalled();
    expect(opts.onNavigate).toHaveBeenCalledWith("ArrowDown");
  });

  // Ctrl+Z in both views, dispatched from the shared registry so the cheat-sheet lists it too.
  describe("undo and redo", () => {
    it("Ctrl+Z reaches undo", () => {
      const options = mindmapKeyboardContext();
      renderHook((opts) => useKeyboardMindmap(opts), { initialProps: options });
      fireKey("z", { ctrlKey: true });
      expect(options.onUndo).toHaveBeenCalledTimes(1);
      expect(options.onRedo).not.toHaveBeenCalled();
    });

    it("Ctrl+Shift+Z reaches redo, and not undo", () => {
      const options = mindmapKeyboardContext();
      renderHook((opts) => useKeyboardMindmap(opts), { initialProps: options });
      fireKey("z", { ctrlKey: true, shiftKey: true });
      expect(options.onRedo).toHaveBeenCalledTimes(1);
      expect(options.onUndo).not.toHaveBeenCalled();
    });

    it("Ctrl+Y reaches redo as well", () => {
      const options = mindmapKeyboardContext();
      renderHook((opts) => useKeyboardMindmap(opts), { initialProps: options });
      fireKey("y", { ctrlKey: true });
      expect(options.onRedo).toHaveBeenCalledTimes(1);
    });

    it("ignores both while an input is active", () => {
      const options = mindmapKeyboardContext({ isInputActive: true });
      renderHook((opts) => useKeyboardMindmap(opts), { initialProps: options });
      fireKey("z", { ctrlKey: true });
      fireKey("z", { ctrlKey: true, shiftKey: true });
      expect(options.onUndo).not.toHaveBeenCalled();
      expect(options.onRedo).not.toHaveBeenCalled();
    });

    // Inside a field Ctrl+Z means the field undo the browser already gives, not the board's.
    it("leaves a keystroke from inside a text field alone", () => {
      const options = mindmapKeyboardContext();
      renderHook((opts) => useKeyboardMindmap(opts), { initialProps: options });
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

describe("useKeyboardMindmap — Shift+initial creates a typed child", () => {
  const CHORDS: ReadonlyArray<[string, TypedChildKind]> = [
    ["d", "domain"],
    ["p", "project"],
    ["g", "goal"],
    ["t", "task"],
    ["i", "info"],
    ["f", "flow"],
    ["c", "commitment"],
  ];

  for (const [key, kind] of CHORDS) {
    it(`Shift+${key.toUpperCase()} asks for a ${kind} child of the selection`, () => {
      const opts = mindmapKeyboardContext();
      renderHook(() => useKeyboardMindmap(opts));
      fireKey(key, { shiftKey: true });
      expect(opts.onCreateTypedChild).toHaveBeenCalledWith("task-1", kind);
    });

    it(`Shift+${key.toUpperCase()} does nothing at all with no selection`, () => {
      const opts = mindmapKeyboardContext({ selectedNodeId: null, selectedNodeIds: new Set<string>() });
      renderHook(() => useKeyboardMindmap(opts));
      fireKey(key, { shiftKey: true });
      expect(opts.onCreateTypedChild).not.toHaveBeenCalled();
    });
  }

  it("leaves bare C centering on the selection, not creating a commitment", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("c");
    expect(opts.onCenterOnNode).toHaveBeenCalledWith("task-1");
    expect(opts.onCreateTypedChild).not.toHaveBeenCalled();
  });

  it("leaves Ctrl+C copying, not creating a commitment", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("c", { ctrlKey: true });
    expect(opts.onCreateTypedChild).not.toHaveBeenCalled();
  });

  it("leaves bare F converting the selection to a Flow", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("f");
    expect(opts.onConvertToFlow).toHaveBeenCalledWith("task-1");
    expect(opts.onCreateTypedChild).not.toHaveBeenCalled();
  });

  it("Shift+F creates a Flow child and does not convert the selection", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("f", { shiftKey: true });
    expect(opts.onCreateTypedChild).toHaveBeenCalledWith("task-1", "flow");
    expect(opts.onConvertToFlow).not.toHaveBeenCalled();
  });

  it("leaves Tab creating an inherit-the-parent child", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("Tab");
    expect(opts.onCreateChild).toHaveBeenCalledWith("task-1");
    expect(opts.onCreateTypedChild).not.toHaveBeenCalled();
  });

  it("does not fire on a plain letter — Shift is what distinguishes the chord", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("d");
    fireKey("t", { ctrlKey: true });
    fireKey("g", { altKey: true });
    expect(opts.onCreateTypedChild).not.toHaveBeenCalled();
  });

  it("ignores a held-key repeat so one press never spawns two children", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "t", code: "KeyT", shiftKey: true, repeat: true, bubbles: true, cancelable: true,
    }));
    expect(opts.onCreateTypedChild).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — Enter cycles a commitment's verdict", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("cycles the verdict once the double-tap window has passed", () => {
    vi.useFakeTimers();
    const opts = commitmentSelected();
    renderHook(() => useKeyboardMindmap(opts));

    fireKey("Enter");
    // Nothing is written while the press could still turn out to be half of a double tap.
    expect(opts.onCycleVerdict).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(opts.onCycleVerdict).toHaveBeenCalledWith("commitment-1");
    // A verdict is not a status: the commitment branch never reaches the task/goal one.
    expect(opts.onCycleStatus).not.toHaveBeenCalled();
  });

  it("enters the subtree on a double tap and records no verdict at all", () => {
    // Navigating into a commitment must not decide anything about it — the whole point of
    // holding the cycle back. The first press of the pair is dropped, not written and undone.
    vi.useFakeTimers();
    const opts = commitmentSelected();
    renderHook(() => useKeyboardMindmap(opts));

    fireKey("Enter");
    vi.advanceTimersByTime(100);
    fireKey("Enter");

    expect(opts.onEnterSubtree).toHaveBeenCalledWith("commitment-1");
    vi.advanceTimersByTime(500);
    expect(opts.onCycleVerdict).not.toHaveBeenCalled();
  });

  it("cycles twice for two presses further apart than the window", () => {
    vi.useFakeTimers();
    const opts = commitmentSelected();
    renderHook(() => useKeyboardMindmap(opts));

    fireKey("Enter");
    vi.advanceTimersByTime(400);
    fireKey("Enter");
    vi.advanceTimersByTime(300);

    expect(opts.onCycleVerdict).toHaveBeenCalledTimes(2);
    expect(opts.onEnterSubtree).not.toHaveBeenCalled();
  });

  it("leaves Enter on a task cycling its status, immediately", () => {
    vi.useFakeTimers();
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));

    fireKey("Enter");
    expect(opts.onCycleStatus).toHaveBeenCalledWith("task-1");
    vi.advanceTimersByTime(500);
    expect(opts.onCycleVerdict).not.toHaveBeenCalled();
  });

  it("drops a pending cycle when the canvas goes away", () => {
    vi.useFakeTimers();
    const opts = commitmentSelected();
    const { unmount } = renderHook(() => useKeyboardMindmap(opts));

    fireKey("Enter");
    unmount();
    vi.advanceTimersByTime(500);

    expect(opts.onCycleVerdict).not.toHaveBeenCalled();
  });
});

describe("useKeyboardMindmap — X records Broken", () => {
  it("marks the selected commitment broken, in one press from any verdict", () => {
    const opts = commitmentSelected();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("x");
    expect(opts.onMarkBroken).toHaveBeenCalledWith("commitment-1");
  });

  it("does nothing on a task, which has no verdict to record", () => {
    const opts = mindmapKeyboardContext();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("x");
    expect(opts.onMarkBroken).not.toHaveBeenCalled();
  });

  it("is not Ctrl+X, which still cuts", () => {
    const opts = commitmentSelected();
    renderHook(() => useKeyboardMindmap(opts));
    fireKey("x", { ctrlKey: true });
    expect(opts.onMarkBroken).not.toHaveBeenCalled();
    expect(opts.onCut).toHaveBeenCalled();
  });
});
