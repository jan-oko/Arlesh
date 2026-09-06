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
    selectedNodeIds: new Set([selectedNodeId]),
    positions: POSITIONS,
    tree: TREE,
    orientation: "horizontal" as const,
    selectNode: vi.fn(),
    setSelection: vi.fn(),
  };
}

// Four siblings in a vertical line, for walking/shrinking a sibling selection range.
//  root2
//  ├── p (y=-300)
//  ├── q (y=-100)
//  ├── r (y=100)
//  └── s (y=300)
const P = node("p", "aspect");
const Q = node("q", "aspect");
const R = node("r", "aspect");
const S = node("s", "aspect");
const SIBLING_TREE = node("root2", "domain", [P, Q, R, S]);

const SIBLING_POSITIONS = new Map<string, Position>([
  ["root2", { x: 0, y: 0, depth: 0 }],
  ["p", { x: 0, y: -300, depth: 1 }],
  ["q", { x: 0, y: -100, depth: 1 }],
  ["r", { x: 0, y: 100, depth: 1 }],
  ["s", { x: 0, y: 300, depth: 1 }],
]);

function makeSiblingOpts(selectedNodeId: string, selectedNodeIds: ReadonlySet<string> = new Set([selectedNodeId])) {
  return {
    selectedNodeId,
    selectedNodeIds,
    positions: SIBLING_POSITIONS,
    tree: SIBLING_TREE,
    orientation: "horizontal" as const,
    selectNode: vi.fn(),
    setSelection: vi.fn(),
  };
}

describe("useNavigateArrow", () => {
  it("does nothing when no node is selected", () => {
    const selectNode = vi.fn();
    const { result } = renderHook(() => useNavigateArrow({
      selectedNodeId: null, selectedNodeIds: new Set(), positions: POSITIONS, tree: TREE, orientation: "horizontal" as const, selectNode, setSelection: vi.fn(),
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

describe("useNavigateArrow — extendSelection", () => {
  it("does nothing when no node is selected", () => {
    const opts = { ...makeSiblingOpts("q"), selectedNodeId: null };
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.extendSelection("ArrowDown"); });
    expect(opts.setSelection).not.toHaveBeenCalled();
  });

  it("extends from the anchor to the next sibling below", () => {
    const opts = makeSiblingOpts("q");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.extendSelection("ArrowDown"); });
    expect(opts.setSelection).toHaveBeenCalledWith(new Set(["q", "r"]), "q");
  });

  it("extends from the anchor to the next sibling above", () => {
    const opts = makeSiblingOpts("q");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.extendSelection("ArrowUp"); });
    expect(opts.setSelection).toHaveBeenCalledWith(new Set(["p", "q"]), "q");
  });

  it("walks the moving focus further on repeated extends in the same direction", () => {
    const opts = makeSiblingOpts("q");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.extendSelection("ArrowDown"); });
    act(() => { result.current.extendSelection("ArrowDown"); });
    expect(opts.setSelection).toHaveBeenLastCalledWith(new Set(["q", "r", "s"]), "q");
  });

  it("shrinks the range back when reversing direction", () => {
    const opts = makeSiblingOpts("q");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.extendSelection("ArrowDown"); });
    act(() => { result.current.extendSelection("ArrowDown"); });
    act(() => { result.current.extendSelection("ArrowUp"); });
    expect(opts.setSelection).toHaveBeenLastCalledWith(new Set(["q", "r"]), "q");
  });

  it("does nothing further past the last sibling in that direction", () => {
    const opts = makeSiblingOpts("s");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.extendSelection("ArrowDown"); });
    expect(opts.setSelection).not.toHaveBeenCalled();
  });

  it("restarts fresh from the new anchor once the selection collapses back to one node", () => {
    const opts = makeSiblingOpts("q");
    const { result, rerender } = renderHook((props) => useNavigateArrow(props), { initialProps: opts });
    act(() => { result.current.extendSelection("ArrowDown"); }); // focus moves to r

    // Selection collapsed back to a single node ("s") — a fresh anchor for the next sequence.
    const nextOpts = makeSiblingOpts("s", new Set(["s"]));
    rerender(nextOpts);
    act(() => { result.current.extendSelection("ArrowUp"); });
    // Extends one step from the new anchor "s", not from the stale "r" focus of the previous sequence.
    expect(nextOpts.setSelection).toHaveBeenCalledWith(new Set(["r", "s"]), "s");
  });
});

// Vertical orientation: the axes swap — depth runs down the y axis, siblings spread along x.
//        root
//     ┌────┴────┐
//    [a]       [b]      (y=90)
//     │
//  [a-child]            (y=180)
const V_POSITIONS = new Map<string, Position>([
  ["root",    { x: 0,    y: 0,   depth: 0 }],
  ["a",       { x: -220, y: 90,  depth: 1 }],
  ["b",       { x: 220,  y: 90,  depth: 1 }],
  ["a-child", { x: -220, y: 180, depth: 2 }],
]);

function makeVerticalOpts(selectedNodeId: string, selectedNodeIds: ReadonlySet<string> = new Set([selectedNodeId])) {
  return {
    selectedNodeId,
    selectedNodeIds,
    positions: V_POSITIONS,
    tree: TREE,
    orientation: "vertical" as const,
    selectNode: vi.fn(),
    setSelection: vi.fn(),
  };
}

describe("useNavigateArrow — vertical orientation", () => {
  it("ArrowDown from a moves to its child", () => {
    const opts = makeVerticalOpts("a");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.navigateArrow("ArrowDown"); });
    expect(opts.selectNode).toHaveBeenCalledWith("a-child");
  });

  it("ArrowUp from child moves back to its parent", () => {
    const opts = makeVerticalOpts("a-child");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.navigateArrow("ArrowUp"); });
    expect(opts.selectNode).toHaveBeenCalledWith("a");
  });

  it("ArrowRight from a moves to sibling b", () => {
    const opts = makeVerticalOpts("a");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.navigateArrow("ArrowRight"); });
    expect(opts.selectNode).toHaveBeenCalledWith("b");
  });

  it("ArrowLeft from b moves to sibling a", () => {
    const opts = makeVerticalOpts("b");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.navigateArrow("ArrowLeft"); });
    expect(opts.selectNode).toHaveBeenCalledWith("a");
  });

  it("ArrowDown from a does not escape to a sibling", () => {
    const opts = makeVerticalOpts("b");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.navigateArrow("ArrowLeft"); });
    expect(opts.selectNode).not.toHaveBeenCalledWith("a-child");
  });

  it("extends a sibling selection along the horizontal axis", () => {
    const opts = makeVerticalOpts("a");
    const { result } = renderHook(() => useNavigateArrow(opts));
    act(() => { result.current.extendSelection("ArrowRight"); });
    expect(opts.setSelection).toHaveBeenCalledWith(new Set(["a", "b"]), "a");
  });
});
