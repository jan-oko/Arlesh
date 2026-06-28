import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNavigateArrow } from "./use-navigate-arrow";
import type { MindmapNode, Position } from "@/utils/tree-layout";

function node(id: string, kind: MindmapNode["kind"], children: MindmapNode[] = []): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children };
}

// Tree shape:
//  root
//  ├── a   (x=220, y=-90)   ── a-child (x=440, y=-90)
//  └── b   (x=-220, y=90)
const A_CHILD = node("a-child", "domain");
const A = node("a", "aspect", [A_CHILD]);
const B = node("b", "aspect");
const TREE = node("root", "domain", [A, B]);

const POSITIONS = new Map<string, Position>([
  ["root",    { x: 0,    y: 0,   depth: 0 }],
  ["a",       { x: 220,  y: -90, depth: 1 }],
  ["b",       { x: -220, y: 90,  depth: 1 }],
  ["a-child", { x: 440,  y: -90, depth: 2 }],
]);

function makeOpts(selectedNodeId: string) {
  return {
    selectedNodeId,
    positions: POSITIONS,
    tree: TREE,
    selectNode: vi.fn(),
  };
}

describe("useNavigateArrow", () => {
  it("does nothing when no node is selected", () => {
    const selectNode = vi.fn();
    const { result } = renderHook(() => useNavigateArrow({
      selectedNodeId: null, positions: POSITIONS, tree: TREE, selectNode,
    }));
    act(() => { result.current.navigateArrow("ArrowRight"); });
    expect(selectNode).not.toHaveBeenCalled();
  });

  it("ArrowRight from aspect moves to its child", () => {
    const opts = makeOpts("a");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.navigateArrow("ArrowRight"); });
    expect(opts.selectNode).toHaveBeenCalledWith("a-child");
  });

  it("ArrowLeft from child moves back to its parent", () => {
    const opts = makeOpts("a-child");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.navigateArrow("ArrowLeft"); });
    expect(opts.selectNode).toHaveBeenCalledWith("a");
  });

  it("ArrowDown from a moves to sibling b (lower y)", () => {
    const opts = makeOpts("a");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.navigateArrow("ArrowDown"); });
    expect(opts.selectNode).toHaveBeenCalledWith("b");
  });

  it("ArrowUp from b moves to sibling a (higher y)", () => {
    const opts = makeOpts("b");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.navigateArrow("ArrowUp"); });
    expect(opts.selectNode).toHaveBeenCalledWith("a");
  });
});
