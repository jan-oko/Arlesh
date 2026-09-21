import { beforeEach, describe, expect, it } from "vitest";
import { useMindmapStore } from "./use-mindmap-store";

beforeEach(() => {
  useMindmapStore.setState({
    selectedNodeId: null,
    selectedNodeIds: new Set(),
    subtreeRootId: null,
    collapsedNodeIds: new Set(),
    expandedRunIds: new Set(),
    pendingToast: null,
  });
});

describe("selectNode", () => {
  it("sets selectedNodeId and a singleton selection set", () => {
    useMindmapStore.getState().selectNode("node-1");
    const s = useMindmapStore.getState();
    expect(s.selectedNodeId).toBe("node-1");
    expect(s.selectedNodeIds).toEqual(new Set(["node-1"]));
  });

  it("clears both when called with null", () => {
    useMindmapStore.getState().selectNode("node-1");
    useMindmapStore.getState().selectNode(null);
    const s = useMindmapStore.getState();
    expect(s.selectedNodeId).toBeNull();
    expect(s.selectedNodeIds.size).toBe(0);
  });
});

describe("addToSelection", () => {
  it("adds a node to the multi-selection", () => {
    useMindmapStore.getState().addToSelection("a");
    useMindmapStore.getState().addToSelection("b");
    expect(useMindmapStore.getState().selectedNodeIds).toEqual(new Set(["a", "b"]));
  });

  it("toggles off: removes a node already in the selection", () => {
    useMindmapStore.getState().addToSelection("a");
    useMindmapStore.getState().addToSelection("b");
    useMindmapStore.getState().addToSelection("a");
    expect(useMindmapStore.getState().selectedNodeIds).toEqual(new Set(["b"]));
  });

  it("clears selectedNodeId when last member is removed", () => {
    useMindmapStore.getState().addToSelection("only");
    useMindmapStore.getState().addToSelection("only");
    expect(useMindmapStore.getState().selectedNodeId).toBeNull();
    expect(useMindmapStore.getState().selectedNodeIds.size).toBe(0);
  });

  it("updates selectedNodeId anchor to first remaining node when one is removed from multi-select", () => {
    useMindmapStore.getState().addToSelection("a");
    useMindmapStore.getState().addToSelection("b");
    useMindmapStore.getState().addToSelection("a");
    // "a" removed; "b" remains → selectedNodeId should update to "b"
    expect(useMindmapStore.getState().selectedNodeId).toBe("b");
    expect(useMindmapStore.getState().selectedNodeIds).toEqual(new Set(["b"]));
  });
});

describe("setSelection", () => {
  it("replaces selection and sets anchor", () => {
    useMindmapStore.getState().setSelection(new Set(["a", "b", "c"]), "b");
    const s = useMindmapStore.getState();
    expect(s.selectedNodeIds).toEqual(new Set(["a", "b", "c"]));
    expect(s.selectedNodeId).toBe("b");
  });
});

describe("enterSubtree / exitSubtree / exitToRoot", () => {
  it("enterSubtree sets subtreeRootId and selects the node", () => {
    useMindmapStore.getState().enterSubtree("domain-1");
    const s = useMindmapStore.getState();
    expect(s.subtreeRootId).toBe("domain-1");
    expect(s.selectedNodeId).toBe("domain-1");
    expect(s.selectedNodeIds).toEqual(new Set(["domain-1"]));
  });

  it("exitSubtree makes subtreeRootId the parent and selectedNodeId the former root", () => {
    useMindmapStore.getState().enterSubtree("parent");
    useMindmapStore.getState().enterSubtree("child");
    useMindmapStore.getState().exitSubtree("parent");
    const s = useMindmapStore.getState();
    expect(s.subtreeRootId).toBe("parent");
    expect(s.selectedNodeId).toBe("child");
  });

  it("exitSubtree with null root selects the former subtree root", () => {
    useMindmapStore.getState().enterSubtree("node");
    useMindmapStore.getState().exitSubtree(null);
    const s = useMindmapStore.getState();
    expect(s.subtreeRootId).toBeNull();
    // The node we were rooted in stays selected so it's visible in the parent view
    expect(s.selectedNodeId).toBe("node");
    expect(s.selectedNodeIds).toEqual(new Set(["node"]));
  });

  it("exitToRoot clears all subtree and selection state", () => {
    useMindmapStore.getState().enterSubtree("some-node");
    useMindmapStore.getState().exitToRoot();
    const s = useMindmapStore.getState();
    expect(s.subtreeRootId).toBeNull();
    expect(s.selectedNodeId).toBeNull();
    expect(s.selectedNodeIds.size).toBe(0);
  });
});

describe("toggleCollapsed", () => {
  it("adds a node to the collapsed set", () => {
    useMindmapStore.getState().toggleCollapsed("node-1");
    expect(useMindmapStore.getState().collapsedNodeIds.has("node-1")).toBe(true);
  });

  it("removes a node already in the collapsed set", () => {
    useMindmapStore.getState().toggleCollapsed("node-1");
    useMindmapStore.getState().toggleCollapsed("node-1");
    expect(useMindmapStore.getState().collapsedNodeIds.has("node-1")).toBe(false);
  });

  it("does not affect other collapsed nodes", () => {
    useMindmapStore.getState().toggleCollapsed("a");
    useMindmapStore.getState().toggleCollapsed("b");
    useMindmapStore.getState().toggleCollapsed("a");
    expect(useMindmapStore.getState().collapsedNodeIds.has("b")).toBe(true);
  });
});

describe("showToast / clearToast", () => {
  it("stores and clears a toast", () => {
    useMindmapStore.getState().showToast({ nodeId: "n", message: "hi" });
    expect(useMindmapStore.getState().pendingToast).toEqual({ nodeId: "n", message: "hi" });
    useMindmapStore.getState().clearToast();
    expect(useMindmapStore.getState().pendingToast).toBeNull();
  });
});

describe("toggleRunExpanded", () => {
  it("opens a folded habit history and folds it again", () => {
    useMindmapStore.getState().toggleRunExpanded("habitrun-7-virtual");
    expect(useMindmapStore.getState().expandedRunIds.has("habitrun-7-virtual")).toBe(true);
    useMindmapStore.getState().toggleRunExpanded("habitrun-7-virtual");
    expect(useMindmapStore.getState().expandedRunIds.has("habitrun-7-virtual")).toBe(false);
  });

  it("leaves the ordinary collapsed set alone", () => {
    useMindmapStore.getState().toggleRunExpanded("habitrun-7-virtual");
    expect(useMindmapStore.getState().collapsedNodeIds.has("habitrun-7-virtual")).toBe(false);
  });
});
