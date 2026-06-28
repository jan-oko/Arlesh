import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasLayout } from "./use-canvas-layout";
import type { MindmapNode } from "@/utils/tree-layout";

function node(id: string, children: MindmapNode[] = []): MindmapNode {
  return { id, kind: "domain", title: id, position: 0, tagIds: [], children };
}

const LEAF = node("leaf");
const ASPECT = node("aspect", [LEAF]);
const TREE = node("root", [ASPECT]);

function baseOptions(overrides: Partial<Parameters<typeof useCanvasLayout>[0]> = {}) {
  return {
    displayRoot: TREE,
    tree: TREE,
    collapsedNodeIds: new Set<string>(),
    dragSourceId: null,
    dragTargetId: null,
    ...overrides,
  };
}

describe("useCanvasLayout", () => {
  it("effectiveCollapsedIds equals collapsedNodeIds when not dragging", () => {
    const collapsed = new Set(["leaf"]);
    const { result } = renderHook(() => useCanvasLayout(baseOptions({ collapsedNodeIds: collapsed })));
    expect(result.current.effectiveCollapsedIds).toBe(collapsed);
  });

  it("effectiveCollapsedIds includes dragSourceId when dragging", () => {
    const { result } = renderHook(() => useCanvasLayout(baseOptions({
      collapsedNodeIds: new Set<string>(),
      dragSourceId: "aspect",
    })));
    expect(result.current.effectiveCollapsedIds.has("aspect")).toBe(true);
  });

  it("positions map contains the display root", () => {
    const { result } = renderHook(() => useCanvasLayout(baseOptions()));
    expect(result.current.positions.has("root")).toBe(true);
  });

  it("positions map contains visible children of root", () => {
    const { result } = renderHook(() => useCanvasLayout(baseOptions()));
    expect(result.current.positions.has("aspect")).toBe(true);
  });

  it("subtreeLayout is null when there is no drag source", () => {
    const { result } = renderHook(() => useCanvasLayout(baseOptions()));
    expect(result.current.subtreeLayout).toBeNull();
  });

  it("placeholderPos is null when there is no drag target", () => {
    const { result } = renderHook(() => useCanvasLayout(baseOptions({ dragSourceId: "leaf" })));
    expect(result.current.placeholderPos).toBeNull();
  });

  it("placeholderPos has positive x when target is on the right side of root", () => {
    // When both source and target are set, placeholderPos should be non-null.
    const { result } = renderHook(() => useCanvasLayout(baseOptions({
      dragSourceId: "leaf",
      dragTargetId: "aspect",
    })));
    expect(result.current.placeholderPos).not.toBeNull();
    expect(result.current.placeholderPos!.x).toBeGreaterThan(0);
  });
});
